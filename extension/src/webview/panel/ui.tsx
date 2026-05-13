/** @jsxRuntime automatic */
/** @jsxImportSource preact */

import { useState, useEffect, useRef, useCallback } from 'preact/hooks';

import type {
  ActiveRunSummary,
  ChatMessage,
  ChatPrefs,
  ComposerInput,
  ComposerInputDraft,
  ContextWindowUsage,
  ModelInfo,
  ModelSettings,
  SystemPromptEntry,
  ThinkingLevel,
} from '../../shared/protocol';
import { CHAT_PREF_MENU_SECTIONS, toggleChatPref } from './chat-prefs';
import { buildContextWindowBreakdown } from './context-window-breakdown';
import { buildContextWindowIndicatorState } from './context-window-indicator';
import { shouldHandleGlobalComposerPaste } from './composer-affordances';
import { resolveComposerModelState } from './composer-model-state';
import {
  canAcceptComposerTransfer,
  extractComposerInputs,
  formatComposerTransferError,
  hasClipboardFilePayload,
} from './file-drop';
import {
  composerInputDetail,
  composerInputDisplayName,
  composerInputTitle,
  describeComposerInputSummary,
} from './composer-inputs';
import { getComposerRunControls } from './session-tab-run-state';
export { SessionTabs } from './session-tabs';

// ─── Composer ────────────────────────────────────────────────────────────────

const THINKING_LEVEL_LABELS: Record<ThinkingLevel, string> = {
  off: 'Off',
  minimal: 'Minimal',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Max',
};

interface ComposerSettingsMenuProps {
  prefs: ChatPrefs;
  onSetPrefs: (prefs: Partial<ChatPrefs>) => void;
}

function ComposerSettingsMenu({ prefs, onSetPrefs }: ComposerSettingsMenuProps) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  return (
    <div ref={menuRef} class="toolbar-settings">
      <button
        class={`toolbar-settings-trigger${open ? ' open' : ''}`}
        type="button"
        aria-label="Chat settings"
        aria-haspopup="menu"
        aria-expanded={open}
        title="Chat settings"
        onClick={() => setOpen((current) => !current)}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33h.01a1.65 1.65 0 0 0 .99-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h.01a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.01a1.65 1.65 0 0 0 1.51.99H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </button>

      {open && (
        <div class="toolbar-settings-menu" role="menu" aria-label="Chat settings menu">
          {CHAT_PREF_MENU_SECTIONS.map((section) => (
            <div key={section.id} class="toolbar-settings-section">
              {section.label && <div class="toolbar-settings-section-label">{section.label}</div>}
              <div class="toolbar-settings-list">
                {section.items.map((item) => {
                  const checked = prefs[item.key];
                  return (
                    <button
                      key={item.key}
                      class={`toolbar-settings-item${checked ? ' checked' : ''}`}
                      type="button"
                      role="menuitemcheckbox"
                      aria-checked={checked}
                      onClick={() => onSetPrefs(toggleChatPref(prefs, item.key))}
                    >
                      <span class="toolbar-settings-item-check" aria-hidden="true">
                        <svg width="12" height="12" viewBox="0 0 13 13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style={checked ? '' : 'opacity:0'}>
                          <polyline points="2.5,6.5 5,9 10.5,3.5" />
                        </svg>
                      </span>
                      <span class="toolbar-settings-item-label">{item.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface ComposerProps {
  busy: boolean;
  draftRestore?: { text: string; nonce: number } | null;
  activeModelId?: string;
  activeThinkingLevel?: ThinkingLevel;
  modelSettings: ModelSettings | null;
  availableModels: ModelInfo[];
  contextUsage: ContextWindowUsage | null;
  prefs: ChatPrefs;
  systemPrompts: SystemPromptEntry[];
  transcript: ChatMessage[];
  pendingComposerInputs: ComposerInput[];
  activeRunSummary?: ActiveRunSummary | null;
  focusTrigger?: string;
  onSend: (text: string) => void;
  onInterrupt: () => void;
  onOpenFilePicker: () => void;
  onAddInput: (input: ComposerInputDraft) => void;
  onRemoveInput: (inputId: string) => void;
  onModelChange: (model: string, thinkingLevel: ThinkingLevel) => void;
  onSetPrefs: (prefs: Partial<ChatPrefs>) => void;
  onMarkComplete?: () => void;
}

function imagePreviewSrc(input: Extract<ComposerInput, { kind: 'imageBlob' }>): string {
  return `data:${input.mimeType};base64,${input.dataBase64}`;
}

export function Composer({
  busy,
  draftRestore,
  activeModelId,
  activeThinkingLevel,
  modelSettings,
  availableModels,
  contextUsage,
  prefs,
  systemPrompts,
  transcript,
  pendingComposerInputs,
  activeRunSummary,
  focusTrigger,
  onSend,
  onInterrupt,
  onOpenFilePicker,
  onAddInput,
  onRemoveInput,
  onModelChange,
  onSetPrefs,
  onMarkComplete,
}: ComposerProps) {
  const [text, setText] = useState('');
  const [isDragActive, setIsDragActive] = useState(false);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const composerShellRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (focusTrigger !== undefined) {
      textareaRef.current?.focus();
    }
  }, [focusTrigger]);

  useEffect(() => {
    if (!draftRestore) {
      return;
    }

    setText(draftRestore.text);
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.value = draftRestore.text;
      textarea.style.height = 'auto';
      textarea.style.height = `${Math.min(textarea.scrollHeight, 160)}px`;
      textarea.focus();
    }
  }, [draftRestore?.nonce]);

  const resetComposer = useCallback(() => {
    setText('');
    setAttachmentError(null);
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
    }
  }, []);

  const {
    selectedModel,
    selectedLevel,
    selectedModelInfo,
    supportsReasoning,
  } = resolveComposerModelState({
    activeModelId,
    activeThinkingLevel,
    modelSettings,
    availableModels,
  });
  const supportsImageInputs = selectedModelInfo?.inputKinds.includes('image') ?? false;
  const runControls = getComposerRunControls(activeRunSummary ?? null);
  const hasUserMessages = transcript.some((msg) => msg.role === 'user');
  const completionAction = runControls.action;

  const applyComposerTransfer = useCallback(async (dataTransfer: DataTransfer | null, source: 'drop' | 'paste') => {
    const { inputs, unsupportedInputs, rejectedFiles } = await extractComposerInputs(dataTransfer, source);
    const acceptedInputs = supportsImageInputs
      ? inputs
      : inputs.filter((input) => input.kind !== 'imageBlob');
    const blockedImageCount = supportsImageInputs
      ? 0
      : inputs.filter((input) => input.kind === 'imageBlob').length;

    for (const input of acceptedInputs) {
      onAddInput(input);
    }
    for (const unsupportedInput of unsupportedInputs) {
      onAddInput(unsupportedInput);
    }

    const unsupportedFileMessage = formatComposerTransferError(rejectedFiles);
    const blockedImageMessage = blockedImageCount > 0
      ? 'The selected model does not support image inputs. Switch to an image-capable model to paste or drop images.'
      : null;
    setAttachmentError([blockedImageMessage, unsupportedFileMessage].filter(Boolean).join(' ') || null);
  }, [onAddInput, supportsImageInputs]);

  const sendCurrentText = useCallback(() => {
    const trimmed = text.trim();
    if ((trimmed.length === 0 && pendingComposerInputs.length === 0) || busy) return;
    onSend(trimmed);
    resetComposer();
  }, [busy, onSend, pendingComposerInputs.length, resetComposer, text]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendCurrentText();
      }
    },
    [sendCurrentText],
  );

  const handleInput = useCallback((e: Event) => {
    const target = e.target as HTMLTextAreaElement;
    setText(target.value);
    target.style.height = 'auto';
    target.style.height = `${Math.min(target.scrollHeight, 160)}px`;
  }, []);

  const handlePaste = useCallback((event: ClipboardEvent) => {
    const dataTransfer = event.clipboardData;
    if (!hasClipboardFilePayload(dataTransfer)) {
      return;
    }

    event.preventDefault();
    void applyComposerTransfer(dataTransfer, 'paste');
  }, [applyComposerTransfer]);

  useEffect(() => {
    const handleDocumentPaste = (event: ClipboardEvent) => {
      if (!shouldHandleGlobalComposerPaste(event.target)) {
        return;
      }

      const dataTransfer = event.clipboardData;
      if (!hasClipboardFilePayload(dataTransfer)) {
        return;
      }

      event.preventDefault();
      textareaRef.current?.focus();
      void applyComposerTransfer(dataTransfer, 'paste');
    };

    document.addEventListener('paste', handleDocumentPaste);
    return () => document.removeEventListener('paste', handleDocumentPaste);
  }, [applyComposerTransfer]);

  const handleDragOver = useCallback((event: DragEvent) => {
    if (!canAcceptComposerTransfer(event.dataTransfer)) {
      return;
    }

    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'copy';
    }
    setIsDragActive(true);
  }, []);

  const handleDragLeave = useCallback((event: DragEvent) => {
    const nextTarget = event.relatedTarget;
    if (nextTarget instanceof Node && composerShellRef.current?.contains(nextTarget)) {
      return;
    }
    setIsDragActive(false);
  }, []);

  const handleDrop = useCallback((event: DragEvent) => {
    if (!canAcceptComposerTransfer(event.dataTransfer)) {
      return;
    }

    event.preventDefault();
    setIsDragActive(false);
    void applyComposerTransfer(event.dataTransfer, 'drop');
  }, [applyComposerTransfer]);

  const effectiveContextWindow = contextUsage?.contextWindow ?? selectedModelInfo?.contextWindow ?? 0;
  const contextBreakdown =
    effectiveContextWindow <= 0
      ? null
      : buildContextWindowBreakdown({
          contextUsage,
          effectiveContextWindow,
          systemPrompts,
          transcript,
        });
  const contextIndicator = contextBreakdown
    ? buildContextWindowIndicatorState(contextBreakdown.summary)
    : null;
  const contextIndicatorClass = contextIndicator?.severity ? ` ${contextIndicator.severity}` : '';
  const canSend = text.trim().length > 0 || pendingComposerInputs.length > 0;
  const attachmentSummary = describeComposerInputSummary(pendingComposerInputs);
  const showAttachmentSummary = pendingComposerInputs.length > 1;
  const composerPlaceholder = busy
    ? 'Waiting for a response...'
    : 'Ask PI anything...';

  return (
    <div class="composer-area">
      <div class="composer-toolbar">
        <ComposerSettingsMenu prefs={prefs} onSetPrefs={onSetPrefs} />

        {availableModels.length > 0 ? (
          <select
            class="model-select"
            value={selectedModel}
            onChange={(e) => {
              const target = e.target as HTMLSelectElement;
              onModelChange(target.value, selectedLevel);
            }}
            aria-label="Model"
            title="Select model"
          >
            {availableModels.map((m) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
        ) : selectedModel ? (
          <span class="model-select-static" title={selectedModel}>{selectedModel}</span>
        ) : null}

        {supportsReasoning && (
          <select
            class="model-select model-select-sm"
            value={selectedLevel}
            onChange={(e) => {
              const target = e.target as HTMLSelectElement;
              onModelChange(selectedModel, target.value as ThinkingLevel);
            }}
            aria-label="Reasoning level"
            title="Reasoning level"
          >
            {(Object.keys(THINKING_LEVEL_LABELS) as ThinkingLevel[]).map((level) => (
              <option key={level} value={level}>{THINKING_LEVEL_LABELS[level]}</option>
            ))}
          </select>
        )}

        {contextIndicator?.label && contextBreakdown && (
          <div class="context-window-indicator-anchor">
            <span
              class={`model-select-static context-window-indicator${contextIndicatorClass}`}
              aria-label={contextIndicator.ariaLabel}
              aria-description={contextBreakdown.title}
              title={contextBreakdown.title}
            >
              {contextIndicator.label}
            </span>
          </div>
        )}

        {runControls.status && (
          <div class="composer-run-controls">
            <span
              class={`composer-meta-chip ${runControls.status.tone}`}
              title={runControls.status.title}
            >
              {runControls.status.text}
            </span>
          </div>
        )}

      </div>

      <div
        ref={composerShellRef}
        class={`composer-input-shell${isDragActive ? ' drag-active' : ''}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {pendingComposerInputs.length > 0 && (
          <div class="composer-attachments" role="group" aria-label={`Pending attachments: ${attachmentSummary}`}>
            {showAttachmentSummary && <span class="composer-attachments-summary">{attachmentSummary}</span>}
            <div class="composer-attachments-strip">
              {pendingComposerInputs.map((input) => {
                const displayName = composerInputDisplayName(input);
                const detail = composerInputDetail(input);

                return (
                  <div key={input.id} class="attachment-card" title={composerInputTitle(input)}>
                    {input.kind === 'imageBlob' ? (
                      <div class="attachment-card-thumb">
                        <img class="attachment-card-image" src={imagePreviewSrc(input)} alt={displayName} />
                      </div>
                    ) : (
                      <div class="attachment-card-icon" aria-hidden="true">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                          <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
                          <path d="M14 3v5h5" />
                          <path d="M9 13h6" />
                          <path d="M9 17h4" />
                        </svg>
                      </div>
                    )}
                    <div class="attachment-card-meta">
                      <span class="attachment-card-name">{displayName}</span>
                      <span class="attachment-card-detail">{detail}</span>
                    </div>
                    <button
                      class="attachment-card-remove"
                      type="button"
                      onClick={() => onRemoveInput(input.id)}
                      aria-label={`Remove ${displayName}`}
                    >
                      ×
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}
        <textarea
          ref={textareaRef}
          class="composer-textarea"
          rows={1}
          placeholder={composerPlaceholder}
          value={text}
          onInput={handleInput}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          aria-label="Message composer"
        />
        <div class="composer-actions">
          <button
            class="action-btn icon-only"
            type="button"
            title="Attach file or folder path"
            onClick={onOpenFilePicker}
            aria-label="Attach file or folder path"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
            </svg>
          </button>
          {completionAction && (
            <button
              class={`composer-run-action ${completionAction.tone}`}
              type="button"
              title={completionAction.title}
              aria-label={completionAction.ariaLabel}
              disabled={busy || !hasUserMessages || !onMarkComplete}
              onClick={() => onMarkComplete?.()}
            >
              {completionAction.text}
            </button>
          )}
          {busy ? (
            <button
              class="action-btn danger"
              type="button"
              title="Interrupt"
              onClick={onInterrupt}
              aria-label="Interrupt response"
            >
              Stop
            </button>
          ) : (
            <button
              class="action-btn primary"
              type="button"
              title="Send (Enter)"
              onClick={sendCurrentText}
              disabled={!canSend}
              aria-label="Send message"
            >
              Send
            </button>
          )}
        </div>
      </div>

      {attachmentError && (
        <div class="composer-hint composer-hint-error" role="status">{attachmentError}</div>
      )}
    </div>
  );
}
