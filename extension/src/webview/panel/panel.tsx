/** @jsxRuntime automatic */
/** @jsxImportSource preact */

import { render } from 'preact';

import type { WebviewToHostMessage } from '../../shared/protocol';
import { App } from './app';

// ─── VS Code API ─────────────────────────────────────────────────────────────

declare function acquireVsCodeApi(): {
  postMessage(msg: WebviewToHostMessage): void;
  getState(): unknown;
  setState(state: unknown): void;
};

const vscodeApi = acquireVsCodeApi();

function postMessage(msg: WebviewToHostMessage): void {
  vscodeApi.postMessage(msg);
}

// ─── Mount ───────────────────────────────────────────────────────────────────

const adapter = { postMessage };

const container = document.getElementById('app');
if (container) {
  render(<App adapter={adapter} />, container);
}
