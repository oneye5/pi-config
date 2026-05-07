import * as cp from 'node:child_process';
import * as vscode from 'vscode';

import { attachJsonlLineReader, serializeJsonLine } from '../shared/jsonl';
import { RequestTracker } from '../shared/request-tracker';
import {
  type BackendReadyPayload,
  type EventEnvelope,
  isEventEnvelope,
  isResponseEnvelope,
  type ResponseEnvelope,
} from '../shared/protocol';

export interface BackendStartOptions {
  nodePath: string;
  backendPath: string;
  sdkPath: string;
  cwd: string;
}

export class BackendClient implements vscode.Disposable {
  private readonly events = new vscode.EventEmitter<EventEnvelope>();
  private readonly exits = new vscode.EventEmitter<{ code: number | null; stderr: string }>();
  private readonly requests = new RequestTracker<ResponseEnvelope>();

  private proc?: cp.ChildProcess;
  private requestCounter = 0;
  private stderrBuffer = '';
  private detachReader?: () => void;

  readonly onEvent = this.events.event;
  readonly onExit = this.exits.event;

  async start(options: BackendStartOptions): Promise<BackendReadyPayload> {
    if (this.proc) {
      throw new Error('Backend is already running');
    }

    this.stderrBuffer = '';
    const proc = cp.spawn(
      options.nodePath,
      [options.backendPath, '--sdkPath', options.sdkPath, '--cwd', options.cwd],
      {
        cwd: options.cwd,
        env: { ...process.env },
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: false,
      },
    );

    this.proc = proc;

    if (!proc.stdout || !proc.stderr || !proc.stdin) {
      this.proc = undefined;
      throw new Error('Backend process did not expose stdio pipes as expected.');
    }

    proc.stderr.setEncoding('utf8');
    proc.stderr.on('data', (chunk: string) => {
      this.stderrBuffer += chunk;
    });

    this.detachReader = attachJsonlLineReader(proc.stdout, (line) => {
      this.handleLine(line);
    });

    proc.on('exit', (code) => {
      this.detachReader?.();
      this.detachReader = undefined;
      this.proc = undefined;
      this.requests.rejectAll(
        new Error(`Backend exited unexpectedly${code === null ? '' : ` with code ${code}`}.`),
      );
      this.exits.fire({ code, stderr: this.stderrBuffer.trim() });
    });

    proc.on('error', (error) => {
      this.requests.rejectAll(error);
    });

    return new Promise<BackendReadyPayload>((resolve, reject) => {
      let settled = false;

      const finishReject = (error: Error) => {
        if (settled) {
          return;
        }
        settled = true;
        readyDisposable.dispose();
        exitDisposable.dispose();
        errorDisposable.dispose();
        clearTimeout(timeout);
        reject(error);
      };

      const finishResolve = (payload: BackendReadyPayload) => {
        if (settled) {
          return;
        }
        settled = true;
        readyDisposable.dispose();
        exitDisposable.dispose();
        errorDisposable.dispose();
        clearTimeout(timeout);
        resolve(payload);
      };

      const readyDisposable = this.onEvent((event) => {
        if (event.event === 'backend.ready') {
          finishResolve(event.payload as BackendReadyPayload);
        }
      });

      const exitDisposable = this.onExit(({ code, stderr }) => {
        finishReject(
          new Error(
            `Backend failed to start${code === null ? '' : ` (code ${code})`}${
              stderr ? `: ${stderr}` : ''
            }`,
          ),
        );
      });

      const errorDisposable = proc.once('error', (error) => {
        this.proc = undefined;
        finishReject(
          new Error(
            `Failed to spawn PI Assistant backend with node=${options.nodePath}, backend=${options.backendPath}, cwd=${options.cwd}: ${error.message}`,
          ),
        );
      });

      const timeout = setTimeout(() => {
        finishReject(new Error('Timed out waiting for the PI Assistant backend to become ready.'));
      }, 30000);
    });
  }

  async request<TResult = unknown>(method: string, params?: unknown): Promise<TResult> {
    if (!this.proc?.stdin) {
      throw new Error('Backend is not running');
    }

    const id = `req-${++this.requestCounter}`;
    const responsePromise = this.requests.create(id, 30000);

    this.proc.stdin.write(serializeJsonLine({ id, method, params }));

    const response = await responsePromise;
    if (!response.ok) {
      throw new Error(response.error.message);
    }

    return response.result as TResult;
  }

  private handleLine(line: string): void {
    let value: unknown;

    try {
      value = JSON.parse(line);
    } catch {
      return;
    }

    if (isResponseEnvelope(value)) {
      this.requests.resolve(value.id, value);
      return;
    }

    if (isEventEnvelope(value)) {
      this.events.fire(value);
    }
  }

  dispose(): void {
    this.detachReader?.();
    this.detachReader = undefined;

    if (this.proc) {
      this.proc.kill();
      this.proc = undefined;
    }

    this.requests.rejectAll(new Error('Backend client disposed.'));
    this.events.dispose();
    this.exits.dispose();
  }
}
