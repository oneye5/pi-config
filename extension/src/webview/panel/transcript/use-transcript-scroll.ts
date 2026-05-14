import { useCallback, useEffect, useLayoutEffect, useRef } from 'preact/hooks';

import type { Overlay } from '../overlay';
import {
  advanceSmoothScrollTop,
  captureScrollAnchor,
  isNearBottom,
  resolveAutoFollowState,
  resolveScrollAnchorDelta,
  type ScrollAnchorCandidate,
  type ScrollAnchorSnapshot,
} from '../auto-scroll';

const MANUAL_SCROLL_INTENT_GRACE_MS = 280;

function getScrollAnchorCandidates(container: HTMLDivElement): ScrollAnchorCandidate[] {
  return Array.from(container.children)
    .map((child, index) => {
      if (!(child instanceof HTMLElement)) {
        return null;
      }

      const key = child.dataset.messageId ?? child.dataset.scrollAnchorId ?? `scroll-anchor-${index}`;
      const rect = child.getBoundingClientRect();
      return {
        key,
        top: rect.top,
        bottom: rect.bottom,
      };
    })
    .filter((candidate): candidate is ScrollAnchorCandidate => candidate !== null);
}

function captureDomScrollAnchor(container: HTMLDivElement): ScrollAnchorSnapshot | null {
  const containerTop = container.getBoundingClientRect().top;
  return captureScrollAnchor(getScrollAnchorCandidates(container), containerTop);
}

function restoreDomScrollAnchor(container: HTMLDivElement, anchor: ScrollAnchorSnapshot | null): boolean {
  const containerTop = container.getBoundingClientRect().top;
  const delta = resolveScrollAnchorDelta(anchor, getScrollAnchorCandidates(container), containerTop);
  if (delta === null || Math.abs(delta) < 1) {
    return false;
  }

  container.scrollTop += delta;
  return true;
}

interface UseTranscriptScrollOptions {
  sessionKey: string | null;
  transcriptLength: number;
  busy: boolean;
  overlay: Overlay;
  systemPromptCount: number;
  hasScrollableTranscript: boolean;
}

export function useTranscriptScroll({
  sessionKey,
  transcriptLength,
  busy,
  overlay,
  systemPromptCount,
  hasScrollableTranscript,
}: UseTranscriptScrollOptions) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const autoFollowRef = useRef(true);
  const lastScrollTopRef = useRef(0);
  const manualScrollIntentUntilRef = useRef(0);
  const pointerScrollIntentRef = useRef(false);
  const hasPositionedForSessionRef = useRef(false);
  const scrollAnchorRef = useRef<ScrollAnchorSnapshot | null>(null);
  const followAnimationFrameRef = useRef<number | null>(null);
  const targetScrollTopRef = useRef<number | null>(null);
  const previousSessionKeyRef = useRef<string | null | undefined>(undefined);

  if (previousSessionKeyRef.current !== sessionKey) {
    previousSessionKeyRef.current = sessionKey;
    autoFollowRef.current = true;
    lastScrollTopRef.current = 0;
    manualScrollIntentUntilRef.current = 0;
    pointerScrollIntentRef.current = false;
    hasPositionedForSessionRef.current = false;
    scrollAnchorRef.current = null;
    targetScrollTopRef.current = null;
    if (followAnimationFrameRef.current !== null) {
      window.cancelAnimationFrame(followAnimationFrameRef.current);
      followAnimationFrameRef.current = null;
    }
  }

  const stopFollowAnimation = useCallback(() => {
    targetScrollTopRef.current = null;
    if (followAnimationFrameRef.current !== null) {
      window.cancelAnimationFrame(followAnimationFrameRef.current);
      followAnimationFrameRef.current = null;
    }
  }, []);

  const runFollowAnimation = useCallback(() => {
    followAnimationFrameRef.current = null;

    const element = scrollRef.current;
    const targetScrollTop = targetScrollTopRef.current;
    if (!element || targetScrollTop === null || !autoFollowRef.current) {
      return;
    }

    const nextScrollTop = advanceSmoothScrollTop(element.scrollTop, targetScrollTop);
    if (Math.abs(nextScrollTop - element.scrollTop) >= 0.5) {
      element.scrollTop = nextScrollTop;
      lastScrollTopRef.current = element.scrollTop;
    }

    if (Math.abs(targetScrollTop - element.scrollTop) <= 1) {
      targetScrollTopRef.current = null;
      return;
    }

    followAnimationFrameRef.current = window.requestAnimationFrame(runFollowAnimation);
  }, []);

  const ensureFollowAnimation = useCallback(() => {
    if (followAnimationFrameRef.current === null) {
      followAnimationFrameRef.current = window.requestAnimationFrame(runFollowAnimation);
    }
  }, [runFollowAnimation]);

  useEffect(() => () => {
    stopFollowAnimation();
  }, [stopFollowAnimation]);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;

    const markManualScrollIntent = () => {
      manualScrollIntentUntilRef.current = Date.now() + MANUAL_SCROLL_INTENT_GRACE_MS;
    };

    const clearPointerScrollIntent = () => {
      pointerScrollIntentRef.current = false;
    };

    autoFollowRef.current = isNearBottom({
      scrollHeight: element.scrollHeight,
      scrollTop: element.scrollTop,
      clientHeight: element.clientHeight,
    });
    lastScrollTopRef.current = element.scrollTop;
    scrollAnchorRef.current = autoFollowRef.current ? null : captureDomScrollAnchor(element);

    const handleWheel = () => {
      markManualScrollIntent();
    };

    const handleTouchStart = () => {
      markManualScrollIntent();
    };

    const handleTouchMove = () => {
      markManualScrollIntent();
    };

    const handlePointerDown = (event: PointerEvent) => {
      if (event.target !== element) {
        return;
      }
      pointerScrollIntentRef.current = true;
      markManualScrollIntent();
    };

    const handleScroll = () => {
      const nextScrollTop = element.scrollTop;
      const hasManualScrollIntent = pointerScrollIntentRef.current
        || Date.now() <= manualScrollIntentUntilRef.current;
      const nextAutoFollow = resolveAutoFollowState({
        previousAutoFollow: autoFollowRef.current,
        previousScrollTop: lastScrollTopRef.current,
        nextScrollTop,
        metrics: {
          scrollHeight: element.scrollHeight,
          scrollTop: nextScrollTop,
          clientHeight: element.clientHeight,
        },
        hasManualScrollIntent,
      });
      autoFollowRef.current = nextAutoFollow;
      lastScrollTopRef.current = nextScrollTop;
      if (!nextAutoFollow) {
        stopFollowAnimation();
      }
      scrollAnchorRef.current = nextAutoFollow ? null : captureDomScrollAnchor(element);
    };

    element.addEventListener('wheel', handleWheel, { passive: true });
    element.addEventListener('touchstart', handleTouchStart, { passive: true });
    element.addEventListener('touchmove', handleTouchMove, { passive: true });
    element.addEventListener('pointerdown', handlePointerDown, { passive: true });
    element.addEventListener('scroll', handleScroll, { passive: true });
    window.addEventListener('pointerup', clearPointerScrollIntent, { passive: true });
    window.addEventListener('pointercancel', clearPointerScrollIntent, { passive: true });
    window.addEventListener('blur', clearPointerScrollIntent);

    return () => {
      element.removeEventListener('wheel', handleWheel);
      element.removeEventListener('touchstart', handleTouchStart);
      element.removeEventListener('touchmove', handleTouchMove);
      element.removeEventListener('pointerdown', handlePointerDown);
      element.removeEventListener('scroll', handleScroll);
      window.removeEventListener('pointerup', clearPointerScrollIntent);
      window.removeEventListener('pointercancel', clearPointerScrollIntent);
      window.removeEventListener('blur', clearPointerScrollIntent);
      clearPointerScrollIntent();
    };
  }, [sessionKey, hasScrollableTranscript, stopFollowAnimation]);

  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element) return;

    if (!hasPositionedForSessionRef.current) {
      hasPositionedForSessionRef.current = true;
      if (autoFollowRef.current) {
        stopFollowAnimation();
        element.scrollTop = element.scrollHeight;
        lastScrollTopRef.current = element.scrollTop;
      } else {
        scrollAnchorRef.current = captureDomScrollAnchor(element);
      }
      return;
    }

    if (!autoFollowRef.current) {
      stopFollowAnimation();
      restoreDomScrollAnchor(element, scrollAnchorRef.current);
      lastScrollTopRef.current = element.scrollTop;
      scrollAnchorRef.current = captureDomScrollAnchor(element);
      return;
    }

    const targetScrollTop = Math.max(0, element.scrollHeight - element.clientHeight);
    if (Math.abs(targetScrollTop - element.scrollTop) < 1) {
      stopFollowAnimation();
      scrollAnchorRef.current = null;
      return;
    }

    targetScrollTopRef.current = targetScrollTop;
    ensureFollowAnimation();
    scrollAnchorRef.current = null;
  }, [sessionKey, transcriptLength, busy, overlay, systemPromptCount, ensureFollowAnimation, stopFollowAnimation]);

  return scrollRef;
}
