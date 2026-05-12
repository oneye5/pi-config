import type { ViewState } from '../../shared/protocol';

export type PanelSurface = 'loading' | 'empty' | 'session';

type PanelSurfaceState = Pick<ViewState, 'backendReady' | 'notice' | 'openTabPaths'>;
type PanelBootState = Pick<ViewState, 'backendReady' | 'notice'>;

export function isPanelBooting(state: PanelBootState): boolean {
  const hasNotice = typeof state.notice === 'string' && state.notice.trim().length > 0;
  return !state.backendReady && !hasNotice;
}

export function resolvePanelSurface(state: PanelSurfaceState): PanelSurface {
  if (isPanelBooting(state)) {
    return 'loading';
  }

  return state.openTabPaths.length > 0 ? 'session' : 'empty';
}
