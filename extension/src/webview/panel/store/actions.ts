import type { WebviewToHostMessage } from '../../../shared/protocol';

let _postMessage: (msg: WebviewToHostMessage) => void = () => {};

export function setPostMessage(fn: (msg: WebviewToHostMessage) => void): void {
  _postMessage = fn;
}

export function postMessage(msg: WebviewToHostMessage): void {
  _postMessage(msg);
}
