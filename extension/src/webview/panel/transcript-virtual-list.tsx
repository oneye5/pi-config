/** @jsxRuntime automatic */
/** @jsxImportSource preact */

import { Virtualizer, elementScroll, observeElementOffset, observeElementRect } from '@tanstack/virtual-core';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';

import { type ChatMessage, type ChatPrefs, type SystemPromptEntry, type ToolCall, type TranscriptWindow } from '../../shared/protocol';
import type { Overlay } from './overlay';
import { isNearBottom } from './auto-scroll';
import { SystemPromptMessage } from './system-prompts';
import { MessageItem } from './transcript/message-item';
import { ToolCallItem } from './transcript/tool-call-item';
import type { RenderToolCall, TranscriptContextMenuHandler } from './transcript/types';

interface TranscriptVirtualListProps {
  sessionKey: string | null;
  transcript: ChatMessage[];
  transcriptWindow: TranscriptWindow;
  busy: boolean;
  overlay: Overlay;
  prefs: ChatPrefs;
  systemPrompts: SystemPromptEntry[];
  workingDirectory: string | null;
  editingId: string | null;
  onEditRequest: (messageId: string) => void;
  onEditConfirm: (messageId: string, text: string) => void;
  onEditCancel: () => void;
  onOpenFile: (path: string) => void;
  onContextMenu: TranscriptContextMenuHandler;
  onLoadOlder: () => void;
  onLoadNewer: () => void;
  onJumpToLatest: () => void;
}

type TranscriptRow =
  | { kind: 'systemPrompts'; key: string }
  | { kind: 'topGap'; key: string }
  | { kind: 'message'; key: string; message: ChatMessage }
  | { kind: 'bottomGap'; key: string };

interface ScrollAnchor {
  messageId: string;
  offsetTop: number;
}

function getEstimateSize(row: TranscriptRow): number {
  if (row.kind === 'systemPrompts') {
    return 140;
  }
  if (row.kind === 'topGap' || row.kind === 'bottomGap') {
    return 56;
  }
  return row.message.role === 'user' ? 120 : 180;
}

function captureTopAnchor(container: HTMLDivElement): ScrollAnchor | null {
  const containerTop = container.getBoundingClientRect().top;
  const candidates = Array.from(container.querySelectorAll<HTMLElement>('[data-message-id]'));
  for (const candidate of candidates) {
    const rect = candidate.getBoundingClientRect();
    if (rect.bottom <= containerTop) {
      continue;
    }

    const messageId = candidate.dataset.messageId;
    if (!messageId) {
      continue;
    }

    return {
      messageId,
      offsetTop: rect.top - containerTop,
    };
  }

  return null;
}

function restoreTopAnchor(container: HTMLDivElement, anchor: ScrollAnchor | null): void {
  if (!anchor) {
    return;
  }

  const containerTop = container.getBoundingClientRect().top;
  const candidates = Array.from(container.querySelectorAll<HTMLElement>('[data-message-id]'));
  const match = candidates.find((candidate) => candidate.dataset.messageId === anchor.messageId);
  if (!match) {
    return;
  }

  const delta = match.getBoundingClientRect().top - containerTop - anchor.offsetTop;
  if (Math.abs(delta) < 1) {
    return;
  }

  container.scrollTop += delta;
}

export function TranscriptVirtualList({
  sessionKey,
  transcript,
  transcriptWindow,
  busy,
  overlay,
  prefs,
  systemPrompts,
  workingDirectory,
  editingId,
  onEditRequest,
  onEditConfirm,
  onEditCancel,
  onOpenFile,
  onContextMenu,
  onLoadOlder,
  onLoadNewer,
  onJumpToLatest,
}: TranscriptVirtualListProps) {
  const [renderTick, setRenderTick] = useState(0);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const [isLoadingNewer, setIsLoadingNewer] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const autoFollowRef = useRef(true);
  const renderFrameRef = useRef<number | null>(null);
  const followFrameRef = useRef<number | null>(null);
  const pendingOlderAnchorRef = useRef<ScrollAnchor | null>(null);
  const loadingOlderRef = useRef(false);
  const loadingNewerRef = useRef(false);
  const loadingOlderTimeoutRef = useRef<number | null>(null);
  const loadingNewerTimeoutRef = useRef<number | null>(null);
  const previousLoadedStartRef = useRef(transcriptWindow.loadedStart);
  const previousLoadedEndRef = useRef(transcriptWindow.loadedEnd);

  const scrollToBottom = useCallback(() => {
    if (followFrameRef.current !== null) {
      window.cancelAnimationFrame(followFrameRef.current);
      followFrameRef.current = null;
    }

    const element = scrollRef.current;
    if (!element) {
      return;
    }

    element.scrollTop = element.scrollHeight;
    setIsAtBottom(true);
  }, []);

  const scheduleScrollToBottom = useCallback(() => {
    if (followFrameRef.current !== null) {
      return;
    }

    followFrameRef.current = window.requestAnimationFrame(() => {
      followFrameRef.current = null;
      scrollToBottom();
    });
  }, [scrollToBottom]);

  const scheduleVirtualRender = useCallback(() => {
    if (renderFrameRef.current !== null) {
      return;
    }

    renderFrameRef.current = window.requestAnimationFrame(() => {
      renderFrameRef.current = null;
      setRenderTick((value) => value + 1);
    });
  }, []);

  const clearLoadingOlderTimeout = useCallback(() => {
    if (loadingOlderTimeoutRef.current === null) {
      return;
    }

    window.clearTimeout(loadingOlderTimeoutRef.current);
    loadingOlderTimeoutRef.current = null;
  }, []);

  const requestOlderPage = useCallback(() => {
    if (loadingOlderRef.current) {
      return;
    }

    const element = scrollRef.current;
    if (element) {
      pendingOlderAnchorRef.current = captureTopAnchor(element);
    }

    loadingOlderRef.current = true;
    setIsLoadingOlder(true);
    onLoadOlder();

    clearLoadingOlderTimeout();
    loadingOlderTimeoutRef.current = window.setTimeout(() => {
      if (loadingOlderRef.current) {
        loadingOlderRef.current = false;
        setIsLoadingOlder(false);
      }
      loadingOlderTimeoutRef.current = null;
    }, 1500);
  }, [clearLoadingOlderTimeout, onLoadOlder]);

  const clearLoadingNewerTimeout = useCallback(() => {
    if (loadingNewerTimeoutRef.current === null) {
      return;
    }

    window.clearTimeout(loadingNewerTimeoutRef.current);
    loadingNewerTimeoutRef.current = null;
  }, []);

  const requestNewerPage = useCallback(() => {
    if (loadingNewerRef.current) {
      return;
    }

    loadingNewerRef.current = true;
    setIsLoadingNewer(true);
    onLoadNewer();

    clearLoadingNewerTimeout();
    loadingNewerTimeoutRef.current = window.setTimeout(() => {
      if (loadingNewerRef.current) {
        loadingNewerRef.current = false;
        setIsLoadingNewer(false);
      }
      loadingNewerTimeoutRef.current = null;
    }, 1500);
  }, [clearLoadingNewerTimeout, onLoadNewer]);

  const rows = useMemo<TranscriptRow[]>(() => {
    const nextRows: TranscriptRow[] = [];
    if (systemPrompts.length > 0) {
      nextRows.push({ kind: 'systemPrompts', key: 'system-prompts' });
    }
    if (transcriptWindow.hasOlder) {
      nextRows.push({ kind: 'topGap', key: 'gap:older' });
    }
    for (const message of transcript) {
      nextRows.push({ kind: 'message', key: `message:${message.id}`, message });
    }
    if (transcriptWindow.hasNewer) {
      nextRows.push({ kind: 'bottomGap', key: 'gap:newer' });
    }
    return nextRows;
  }, [systemPrompts.length, transcript, transcriptWindow.hasOlder, transcriptWindow.hasNewer]);

  const virtualizerRef = useRef<Virtualizer<HTMLDivElement, HTMLDivElement> | null>(null);

  if (!virtualizerRef.current) {
    virtualizerRef.current = new Virtualizer<HTMLDivElement, HTMLDivElement>({
      count: rows.length,
      getScrollElement: () => scrollRef.current,
      estimateSize: (index) => getEstimateSize(rows[index] ?? { kind: 'bottomGap', key: 'fallback-gap' }),
      getItemKey: (index) => rows[index]?.key ?? index,
      scrollToFn: elementScroll,
      observeElementRect,
      observeElementOffset,
      overscan: 10,
      onChange: scheduleVirtualRender,
    });
  }

  const virtualizer = virtualizerRef.current;
  virtualizer.setOptions({
    ...virtualizer.options,
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => getEstimateSize(rows[index] ?? rows[rows.length - 1] ?? { kind: 'bottomGap', key: 'fallback-gap' }),
    getItemKey: (index) => rows[index]?.key ?? index,
    scrollToFn: elementScroll,
    observeElementRect,
    observeElementOffset,
    overscan: 10,
    onChange: scheduleVirtualRender,
  });

  useEffect(() => {
    const cleanup = virtualizer._didMount();
    return cleanup;
  }, [virtualizer]);

  useLayoutEffect(() => {
    virtualizer._willUpdate();
  }, [virtualizer, rows.length, renderTick]);

  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element) {
      return;
    }

    autoFollowRef.current = true;
    loadingOlderRef.current = false;
    loadingNewerRef.current = false;
    setIsLoadingOlder(false);
    setIsLoadingNewer(false);
    clearLoadingOlderTimeout();
    clearLoadingNewerTimeout();
    pendingOlderAnchorRef.current = null;
    previousLoadedStartRef.current = transcriptWindow.loadedStart;
    previousLoadedEndRef.current = transcriptWindow.loadedEnd;

    scrollToBottom();
  }, [
    clearLoadingNewerTimeout,
    clearLoadingOlderTimeout,
    scrollToBottom,
    sessionKey,
  ]);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) {
      return;
    }

    const updateScrollState = () => {
      const nearBottom = isNearBottom({
        scrollHeight: element.scrollHeight,
        scrollTop: element.scrollTop,
        clientHeight: element.clientHeight,
      });
      autoFollowRef.current = nearBottom;
      setIsAtBottom(nearBottom);

      if (element.scrollTop <= 120 && transcriptWindow.hasOlder) {
        requestOlderPage();
      }
    };

    element.addEventListener('scroll', updateScrollState, { passive: true });
    updateScrollState();

    return () => {
      element.removeEventListener('scroll', updateScrollState);
    };
  }, [requestOlderPage, sessionKey, transcriptWindow.hasOlder]);

  useLayoutEffect(() => {
    const previousLoadedStart = previousLoadedStartRef.current;
    const previousLoadedEnd = previousLoadedEndRef.current;
    previousLoadedStartRef.current = transcriptWindow.loadedStart;
    previousLoadedEndRef.current = transcriptWindow.loadedEnd;

    const element = scrollRef.current;
    if (!element) {
      return;
    }

    if (loadingOlderRef.current && transcriptWindow.loadedStart < previousLoadedStart) {
      restoreTopAnchor(element, pendingOlderAnchorRef.current);
      loadingOlderRef.current = false;
      setIsLoadingOlder(false);
      clearLoadingOlderTimeout();
      pendingOlderAnchorRef.current = null;
    }

    if (loadingNewerRef.current && transcriptWindow.loadedEnd > previousLoadedEnd) {
      loadingNewerRef.current = false;
      setIsLoadingNewer(false);
      clearLoadingNewerTimeout();
    }

    if (!transcriptWindow.hasOlder) {
      loadingOlderRef.current = false;
      setIsLoadingOlder(false);
      clearLoadingOlderTimeout();
      pendingOlderAnchorRef.current = null;
    }

    if (!transcriptWindow.hasNewer) {
      loadingNewerRef.current = false;
      setIsLoadingNewer(false);
      clearLoadingNewerTimeout();
    }
  }, [
    clearLoadingNewerTimeout,
    clearLoadingOlderTimeout,
    transcriptWindow.hasNewer,
    transcriptWindow.hasOlder,
    transcriptWindow.loadedEnd,
    transcriptWindow.loadedStart,
    transcript.length,
  ]);

  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element) {
      return;
    }

    if (!autoFollowRef.current || transcriptWindow.hasNewer) {
      return;
    }

    scheduleScrollToBottom();
  }, [busy, overlay, scheduleScrollToBottom, transcript.length, transcriptWindow.hasNewer]);

  useEffect(() => {
    return () => {
      clearLoadingOlderTimeout();
      clearLoadingNewerTimeout();
      if (renderFrameRef.current !== null) {
        window.cancelAnimationFrame(renderFrameRef.current);
        renderFrameRef.current = null;
      }
      if (followFrameRef.current !== null) {
        window.cancelAnimationFrame(followFrameRef.current);
        followFrameRef.current = null;
      }
    };
  }, [clearLoadingNewerTimeout, clearLoadingOlderTimeout]);

  const renderToolCallRef = useRef<RenderToolCall>((_toolCall, _contextMenuHandler) => null);
  const renderToolCall = useCallback<RenderToolCall>((toolCall: ToolCall, contextMenuHandler: TranscriptContextMenuHandler) => (
    <ToolCallItem
      toolCall={toolCall}
      prefs={prefs}
      workingDirectory={workingDirectory}
      onOpenFile={onOpenFile}
      onContextMenu={contextMenuHandler}
      renderToolCall={renderToolCallRef.current}
    />
  ), [onOpenFile, prefs, workingDirectory]);
  renderToolCallRef.current = renderToolCall;

  const measureRowElement = useCallback((element: HTMLDivElement | null) => {
    if (element) {
      virtualizer.measureElement(element);
    }
  }, [virtualizer]);

  const virtualRows = virtualizer.getVirtualItems();
  const totalSize = virtualizer.getTotalSize();

  return (
    <div class="transcript transcript-virtual" ref={scrollRef}>
      <div class="transcript-virtual-inner" style={{ height: `${totalSize}px` }}>
        {virtualRows.map((virtualRow) => {
          const row = rows[virtualRow.index];
          if (!row) {
            return null;
          }

          return (
            <div
              key={row.key}
              data-index={virtualRow.index}
              ref={measureRowElement}
              class={`transcript-virtual-row transcript-virtual-row-${row.kind}`}
              style={{ transform: `translateY(${virtualRow.start}px)` }}
            >
              {row.kind === 'systemPrompts' && (
                <SystemPromptMessage prompts={systemPrompts} />
              )}

              {row.kind === 'topGap' && (
                <div class="transcript-gap-row">
                  <button
                    type="button"
                    class="transcript-gap-btn"
                    disabled={isLoadingOlder}
                    onClick={() => {
                      requestOlderPage();
                    }}
                  >
                    {isLoadingOlder ? 'Loading older messages…' : 'Load older messages'}
                  </button>
                </div>
              )}

              {row.kind === 'message' && (() => {
                const overlayParts = overlay.partsByMessage.get(row.message.id);
                const isStreaming = busy && row.message.status === 'streaming';
                return (
                  <MessageItem
                    key={row.message.id}
                    message={row.message}
                    overlayParts={overlayParts}
                    isStreaming={isStreaming}
                    prefs={prefs}
                    readonly={busy}
                    workingDirectory={workingDirectory}
                    editingId={editingId}
                    onEditRequest={onEditRequest}
                    onEditConfirm={onEditConfirm}
                    onEditCancel={onEditCancel}
                    onOpenFile={onOpenFile}
                    onContextMenu={onContextMenu}
                    renderToolCall={renderToolCall}
                  />
                );
              })()}

              {row.kind === 'bottomGap' && (
                <div class="transcript-gap-row transcript-gap-row-bottom">
                  <button
                    type="button"
                    class="transcript-gap-btn"
                    disabled={isLoadingNewer}
                    onClick={requestNewerPage}
                  >
                    {isLoadingNewer ? 'Loading newer messages…' : 'Load newer messages'}
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {(!isAtBottom || transcriptWindow.hasNewer) && (
        <button
          type="button"
          class="transcript-jump-latest"
          aria-label="Jump to latest"
          title="Jump to latest"
          onClick={() => {
            autoFollowRef.current = true;
            if (transcriptWindow.isPartial || transcriptWindow.hasNewer) {
              onJumpToLatest();
            } else {
              scrollToBottom();
            }
          }}
        >
          <span aria-hidden="true">↓</span>
        </button>
      )}
    </div>
  );
}
