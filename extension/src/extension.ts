import * as cp from 'node:child_process';
import * as path from 'node:path';

import * as vscode from 'vscode';

import { BackendClient } from './host/backend-client';
import { getWebviewRoots, renderWebviewHtml } from './host/webview-assets';
import { resolveCommandInvocation } from './shared/command-invocation';
import {
  getSdkCliPath,
  resolveNodePath,
  resolveSdkPath,
  type CommandResult,
} from './shared/runtime-resolution';
import type {
  BusyChangedPayload,
  ChatMessage,
  ErrorPayload,
  EventEnvelope,
  MessageAbortedPayload,
  MessageDeltaPayload,
  MessageFinishedPayload,
  MessageStartedPayload,
  MessageThinkingPayload,
  ModelInfo,
  ModelSettings,
  SessionListChangedPayload,
  SessionOpenedPayload,
  SessionSummary,
  ToolFinishedPayload,
  ToolStartedPayload,
} from './shared/protocol';

const SIDEBAR_VIEW_TYPE = 'pi-assistant.sessionsView';
const ACTIVE_SESSION_KEY = 'piAssistant.activeSessionPath';
const HIDDEN_SESSION_PATHS_KEY = 'piAssistant.hiddenSessionPaths';

interface ViewState {
  sessions: SessionSummary[];
  hiddenSessionPaths: string[];
  activeSession: SessionSummary | null;
  transcript: ChatMessage[];
  busy: boolean;
  notice: string | null;
  workspaceCwd: string | null;
  systemPrompt: string | null;
  modelSettings: ModelSettings | null;
  availableModels: ModelInfo[];
}

function getWorkspaceCwd(): string | null {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? null;
}

function execCommand(command: string, args: string[]): Promise<CommandResult> {
  return new Promise((resolve) => {
    const invocation = resolveCommandInvocation(command, args);

    cp.execFile(invocation.command, invocation.args, { encoding: 'utf8' }, (error, stdout, stderr) => {
      resolve({
        stdout,
        stderr,
        exitCode:
          error && typeof error.code === 'number'
            ? error.code
            : error
              ? 1
              : 0,
      });
    });
  });
}

function upsertMessage(transcript: ChatMessage[], message: ChatMessage): ChatMessage[] {
  const next = [...transcript];
  const index = next.findIndex((entry) => entry.id === message.id);
  if (index === -1) {
    next.push(message);
  } else {
    next[index] = message;
  }
  return next;
}

function ensureAssistantMessage(transcript: ChatMessage[], messageId: string): ChatMessage[] {
  const existing = transcript.find((entry) => entry.id === messageId);
  if (existing) {
    return transcript;
  }

  return [
    ...transcript,
    {
      id: messageId,
      role: 'assistant',
      createdAt: new Date().toISOString(),
      markdown: '',
      status: 'streaming',
      toolCalls: [],
    },
  ];
}

function updateAssistant(
  transcript: ChatMessage[],
  messageId: string,
  updater: (message: ChatMessage) => ChatMessage,
): ChatMessage[] {
  const ensured = ensureAssistantMessage(transcript, messageId);
  return ensured.map((message) => (message.id === messageId ? updater(message) : message));
}

class SidebarViewProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;
  private ready = false;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly getState: () => ViewState,
    private readonly onMessage: (message: any) => void,
  ) {}

  async resolveWebviewView(webviewView: vscode.WebviewView): Promise<void> {
    this.view = webviewView;
    this.ready = false;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: getWebviewRoots(this.context),
    };
    webviewView.webview.html = await renderWebviewHtml(this.context, webviewView.webview);

    webviewView.webview.onDidReceiveMessage((message) => {
      if (message?.type === 'ready') {
        this.ready = true;
        this.postState();
        return;
      }

      this.onMessage(message);
    });
  }

  reveal(): void {
    this.view?.show(true);
  }

  postState(): void {
    if (this.view && this.ready) {
      void this.view.webview.postMessage({ type: 'state', state: this.getState() });
    }
  }

  postDelta(messageId: string, delta: string): void {
    if (this.view && this.ready) {
      void this.view.webview.postMessage({ type: 'delta', messageId, delta });
    }
  }

  postThinking(messageId: string, thinking: string): void {
    if (this.view && this.ready) {
      void this.view.webview.postMessage({ type: 'thinking', messageId, thinking });
    }
  }

  postToolCall(messageId: string, toolCall: { id: string; name: string; input: unknown; result?: unknown; status: string }): void {
    if (this.view && this.ready) {
      void this.view.webview.postMessage({ type: 'toolCall', messageId, toolCall });
    }
  }
}

class PiAssistantExtension implements vscode.Disposable {
  private readonly backend = new BackendClient();
  private readonly statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  private readonly state: ViewState = {
    sessions: [],
    hiddenSessionPaths: this.context.globalState.get<string[]>(HIDDEN_SESSION_PATHS_KEY) ?? [],
    activeSession: null,
    transcript: [],
    busy: false,
    notice: null,
    workspaceCwd: getWorkspaceCwd(),
    systemPrompt: null,
    modelSettings: null,
    availableModels: [],
  };

  private readonly sidebarProvider: SidebarViewProvider;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.sidebarProvider = new SidebarViewProvider(context, () => this.state, (message) => {
      void this.handleWebviewMessage(message);
    });

    this.statusBar.command = 'pi-assistant.openChat';
    this.statusBar.show();

    this.backend.onEvent((event) => {
      this.handleBackendEvent(event);
    });

    this.backend.onExit(({ stderr }) => {
      this.setNotice(stderr || 'The PI Assistant backend stopped unexpectedly.');
      this.state.busy = false;
      this.render();
    });
  }

  async start(): Promise<void> {
    this.updateStatusBar('Starting');

    try {
      const config = vscode.workspace.getConfiguration('piAssistant');
      const nodePath = resolveNodePath({
        configuredPath: config.get<string>('nodePath'),
        env: process.env,
      });
      const sdkPath = await resolveSdkPath({
        configuredPath: config.get<string>('sdkPath'),
        env: process.env,
        exec: execCommand,
      });

      const backendPath = this.context.asAbsolutePath(path.join('out', 'backend.js'));
      const cwd = this.state.workspaceCwd ?? this.context.extensionPath;

      await this.backend.start({ nodePath, backendPath, sdkPath, cwd });

      const restoredSessionPath = this.context.globalState.get<string>(ACTIVE_SESSION_KEY);
      if (restoredSessionPath) {
        try {
          await this.backend.request('session.open', { sessionPath: restoredSessionPath });
        } catch {
          this.setNotice('The previously active session could not be restored.');
        }
      }

      this.render();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.setNotice(message);
      vscode.window.showErrorMessage(`PI Assistant: ${message}`);
      this.render();
    }
  }

  register(): void {
    this.context.subscriptions.push(
      this.backend,
      this.statusBar,
      vscode.window.registerWebviewViewProvider(SIDEBAR_VIEW_TYPE, this.sidebarProvider, {
        webviewOptions: { retainContextWhenHidden: true },
      }),
      vscode.commands.registerCommand('pi-assistant.openChat', () => {
        this.sidebarProvider.reveal();
      }),
      vscode.commands.registerCommand('pi-assistant.newSession', async () => {
        await this.createNewSession();
      }),
    );
  }

  private render(): void {
    this.sidebarProvider.postState();
    this.updateStatusBar(this.state.notice ? 'Error' : this.state.busy ? 'Thinking' : 'Idle');
  }

  private setNotice(notice: string | null): void {
    this.state.notice = notice;
  }

  private updateStatusBar(state: 'Starting' | 'Idle' | 'Thinking' | 'Error'): void {
    const text =
      state === 'Thinking'
        ? 'PI: Thinking'
        : state === 'Error'
          ? 'PI: Error'
          : state === 'Starting'
            ? 'PI: Starting'
            : 'PI: Idle';

    this.statusBar.text = text;
    this.statusBar.tooltip = this.state.notice ?? 'Open PI Assistant chat';
  }

  private async createNewSession(): Promise<void> {
    const cwd = this.state.workspaceCwd ?? this.context.extensionPath;

    // Optimistic placeholder — shows a tab immediately while the backend responds.
    const placeholder: SessionSummary = {
      path: `__pending__:${Date.now()}`,
      name: 'New Session…',
      cwd,
      modifiedAt: new Date().toISOString(),
      messageCount: 0,
    };
    this.state.sessions = [...this.state.sessions.filter((s) => !s.path.startsWith('__pending__:')), placeholder];
    this.state.activeSession = placeholder;
    this.state.transcript = [];
    this.state.systemPrompt = null;
    this.render();

    await this.backend.request('session.create', { cwd });
    this.sidebarProvider.reveal();
  }

  private async openSession(sessionPath: string): Promise<void> {
    this.showSessionTab(sessionPath);
    await this.backend.request('session.open', { sessionPath });
    this.sidebarProvider.reveal();
  }

  private showSessionTab(sessionPath: string): void {
    if (!this.state.hiddenSessionPaths.includes(sessionPath)) {
      return;
    }

    this.state.hiddenSessionPaths = this.state.hiddenSessionPaths.filter((path) => path !== sessionPath);
    void this.context.globalState.update(HIDDEN_SESSION_PATHS_KEY, this.state.hiddenSessionPaths);
  }

  private async closeSessionTab(sessionPath: string): Promise<void> {
    if (sessionPath === this.state.activeSession?.path && this.state.busy) {
      this.setNotice('Interrupt the active response before closing this session tab.');
      this.render();
      return;
    }

    if (!this.state.hiddenSessionPaths.includes(sessionPath)) {
      this.state.hiddenSessionPaths = [...this.state.hiddenSessionPaths, sessionPath];
      void this.context.globalState.update(HIDDEN_SESSION_PATHS_KEY, this.state.hiddenSessionPaths);
    }

    if (sessionPath !== this.state.activeSession?.path) {
      this.render();
      return;
    }

    const nextSession = this.state.sessions.find(
      (session) =>
        session.path !== sessionPath &&
        session.cwd === this.state.workspaceCwd &&
        !this.state.hiddenSessionPaths.includes(session.path),
    );

    if (nextSession) {
      await this.openSession(nextSession.path);
      return;
    }

    await this.createNewSession();
  }

  private async handleWebviewMessage(message: any): Promise<void> {
    if (message?.type === 'send') {
      const text = typeof message.text === 'string' ? message.text.trim() : '';
      if (!text || !this.state.activeSession) {
        return;
      }

      this.state.transcript = [
        ...this.state.transcript,
        {
          id: `local-user:${Date.now()}`,
          role: 'user',
          createdAt: new Date().toISOString(),
          markdown: text,
          status: 'completed',
        },
      ];
      this.state.busy = true;
      this.render();

      try {
        await this.backend.request('message.send', {
          sessionPath: this.state.activeSession.path,
          text,
        });
      } catch (error) {
        const details = error instanceof Error ? error.message : String(error);
        this.setNotice(details);
        this.state.busy = false;
        this.render();
      }
      return;
    }

    if (message?.type === 'interrupt') {
      try {
        await this.backend.request('message.interrupt', {});
      } catch (error) {
        const details = error instanceof Error ? error.message : String(error);
        this.setNotice(details);
        this.render();
      }
      return;
    }

    if (message?.type === 'newSession') {
      await this.createNewSession();
      return;
    }

    if (message?.type === 'openSession' && typeof message.sessionPath === 'string') {
      await this.openSession(message.sessionPath);
      return;
    }

    if (message?.type === 'closeSession' && typeof message.sessionPath === 'string') {
      await this.closeSessionTab(message.sessionPath);
      return;
    }

    if (message?.type === 'setModel') {
      try {
        const updated = await this.backend.request<ModelSettings>('settings.set', {
          defaultModel: message.defaultModel,
          defaultThinkingLevel: message.defaultThinkingLevel,
        });
        this.state.modelSettings = updated;
        this.render();
      } catch (error) {
        const details = error instanceof Error ? error.message : String(error);
        this.setNotice(details);
        this.render();
      }
    }
  }

  private handleBackendEvent(event: EventEnvelope): void {
    switch (event.event) {
      case 'session.list.changed': {
        const payload = event.payload as SessionListChangedPayload;
        this.state.sessions = payload.sessions;
        if (payload.activeSessionPath && this.state.activeSession?.path !== payload.activeSessionPath) {
          const matching = payload.sessions.find((session) => session.path === payload.activeSessionPath);
          if (matching) {
            this.state.activeSession = matching;
          }
        }
        this.render();
        return;
      }

      case 'session.opened': {
        const payload = event.payload as SessionOpenedPayload;
        this.showSessionTab(payload.session.path);
        this.state.activeSession = payload.session;
        this.state.transcript = payload.transcript;
        // busy is managed exclusively by busy.changed — do not overwrite here
        // (session.opened fires after agent_end where isStreaming may lag)
        this.state.systemPrompt = payload.systemPrompt ?? null;
        this.state.modelSettings = payload.modelSettings ?? null;
        this.state.availableModels = payload.availableModels ?? this.state.availableModels;
        // Remove any placeholder session and replace with the real one
        this.state.sessions = this.state.sessions.filter((s) => !s.path.startsWith('__pending__:'));
        this.setNotice(null);
        void this.context.globalState.update(ACTIVE_SESSION_KEY, payload.session.path);
        this.render();
        return;
      }

      case 'busy.changed': {
        const payload = event.payload as BusyChangedPayload;
        this.state.busy = payload.busy;
        this.render();
        return;
      }

      case 'message.started': {
        const payload = event.payload as MessageStartedPayload;
        this.state.transcript = ensureAssistantMessage(this.state.transcript, payload.messageId);
        this.state.busy = true;
        this.render();
        return;
      }

      case 'message.delta': {
        const payload = event.payload as MessageDeltaPayload;
        this.state.transcript = updateAssistant(this.state.transcript, payload.messageId, (message) => ({
          ...message,
          markdown: `${message.markdown}${payload.delta}`,
          status: 'streaming',
        }));
        // Send delta directly to the webview for smooth streaming — no full re-render.
        this.sidebarProvider.postDelta(payload.messageId, payload.delta);
        return;
      }

      case 'message.thinking': {
        const payload = event.payload as MessageThinkingPayload;
        this.state.transcript = updateAssistant(this.state.transcript, payload.messageId, (message) => ({
          ...message,
          thinking: `${message.thinking ?? ''}${payload.thinking}`,
          status: 'streaming',
        }));
        this.sidebarProvider.postThinking(payload.messageId, payload.thinking);
        return;
      }

      case 'tool.started': {
        const payload = event.payload as ToolStartedPayload;
        const newToolCall = {
          id: payload.toolCallId,
          name: payload.name,
          input: payload.input,
          status: 'running' as const,
        };
        this.state.transcript = updateAssistant(this.state.transcript, payload.messageId, (message) => ({
          ...message,
          toolCalls: [
            ...(message.toolCalls ?? []).filter((toolCall) => toolCall.id !== payload.toolCallId),
            newToolCall,
          ],
        }));
        this.sidebarProvider.postToolCall(payload.messageId, newToolCall);
        return;
      }

      case 'tool.finished': {
        const payload = event.payload as ToolFinishedPayload;
        let updatedToolCall: { id: string; name: string; input: unknown; result?: unknown; status: 'completed' | 'running' | 'failed' } | undefined;
        this.state.transcript = updateAssistant(this.state.transcript, payload.messageId, (message) => {
          const toolCalls = (message.toolCalls ?? []).map((toolCall) => {
            if (toolCall.id !== payload.toolCallId) return toolCall;
            updatedToolCall = { ...toolCall, result: payload.result, status: 'completed' };
            return updatedToolCall;
          });
          return { ...message, toolCalls };
        });
        if (updatedToolCall) {
          this.sidebarProvider.postToolCall(payload.messageId, updatedToolCall);
        }
        return;
      }

      case 'message.finished': {
        const payload = event.payload as MessageFinishedPayload;
        this.state.transcript = upsertMessage(this.state.transcript, payload.message);
        // Full render on completion to reconcile any incremental DOM patches.
        this.render();
        return;
      }

      case 'message.aborted': {
        const payload = event.payload as MessageAbortedPayload;
        if (payload.messageId) {
          this.state.transcript = updateAssistant(this.state.transcript, payload.messageId, (message) => ({
            ...message,
            status: 'interrupted',
          }));
        }
        this.state.busy = false;
        this.render();
        return;
      }

      case 'error': {
        const payload = event.payload as ErrorPayload;
        this.setNotice(payload.message);
        this.state.busy = false;
        vscode.window.showErrorMessage(`PI Assistant: ${payload.message}`);
        this.render();
        return;
      }

      default:
        return;
    }
  }

  dispose(): void {
    this.backend.dispose();
    this.statusBar.dispose();
  }
}

export function activate(context: vscode.ExtensionContext): void {
  const extension = new PiAssistantExtension(context);
  extension.register();
  context.subscriptions.push(extension);

  void extension.start();
}

export function deactivate(): void {}
