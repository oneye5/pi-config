import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';

import { attachJsonlLineReader, serializeJsonLine } from '../shared/jsonl';
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
  RequestEnvelope,
  ResponseEnvelope,
  SessionListChangedPayload,
  SessionOpenedPayload,
  SessionSummary,
  ThinkingLevel,
  ToolFinishedPayload,
  ToolStartedPayload,
} from '../shared/protocol';
import { mapAssistantMessage, mapTranscript, summarizeSession, type SessionEntryLike } from './transcript';

type SdkModule = {
  VERSION: string;
  getAgentDir: () => string;
  AuthStorage: {
    create: (filePath?: string) => unknown;
  };
  SessionManager: {
    continueRecent: (cwd: string) => unknown;
    create: (cwd: string) => unknown;
    open: (sessionPath: string) => unknown;
    listAll: () => Promise<unknown[]>;
  };
  createAgentSessionServices: (options: unknown) => Promise<any>;
  createAgentSessionFromServices: (options: unknown) => Promise<any>;
  createAgentSessionRuntime: (factory: any, options: unknown) => Promise<any>;
};

type SessionManagerLike = {
  getCwd: () => string;
  getSessionFile: () => string | undefined;
  getSessionName: () => string | undefined;
  getBranch: () => SessionEntryLike[];
  getEntries: () => SessionEntryLike[];
};

type SessionLike = {
  model?: { id: string };
  sessionFile?: string;
  sessionName?: string;
  isStreaming: boolean;
  messages: unknown[];
  sessionManager: SessionManagerLike;
  subscribe: (listener: (event: any) => void) => () => void;
  prompt: (text: string, options?: Record<string, unknown>) => Promise<void>;
  abort: () => Promise<void>;
};

type RuntimeLike = {
  session: SessionLike;
  services: {
    modelRegistry: {
      getAvailable: () => Array<{ id: string; name: string; provider: string; reasoning: boolean }>;
    };
  };
  dispose: () => Promise<void>;
};

interface ActiveRequest {
  id: string;
  messageIndex: number;
  currentMessageId?: string;
  lastAssistantMessageId?: string;
  aborted: boolean;
}

const dynamicImport = new Function('specifier', 'return import(specifier)') as (
  specifier: string,
) => Promise<unknown>;

function parseArgs(argv: string[]): { sdkPath: string; cwd: string } {
  let sdkPath = '';
  let cwd = process.cwd();

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = argv[index + 1];
    if (arg === '--sdkPath' && value) {
      sdkPath = value;
      index += 1;
      continue;
    }
    if (arg === '--cwd' && value) {
      cwd = value;
      index += 1;
    }
  }

  if (!sdkPath) {
    throw new Error('Missing required --sdkPath argument.');
  }

  return { sdkPath, cwd };
}

function writeStdout(value: EventEnvelope | ResponseEnvelope): void {
  process.stdout.write(serializeJsonLine(value));
}

function log(message: string): void {
  process.stderr.write(`${message}\n`);
}

function extractRequestError(error: unknown): ErrorPayload {
  if (error instanceof Error) {
    return { code: 'BACKEND_ERROR', message: error.message };
  }
  return { code: 'BACKEND_ERROR', message: String(error) };
}

function responseOk(id: string, result?: unknown): ResponseEnvelope {
  return { id, ok: true, result };
}

function responseError(id: string, code: string, message: string, data?: unknown): ResponseEnvelope {
  return { id, ok: false, error: { code, message, data } };
}

class BackendServer {
  private sdk!: SdkModule;
  private readonly sdkPath: string;
  private readonly startupCwd: string;
  private agentDir = '';
  private authStorage: unknown;
  private runtime?: RuntimeLike;
  private session?: SessionLike;
  private unsubscribe?: () => void;
  private activeRequest?: ActiveRequest;

  constructor(options: { sdkPath: string; cwd: string }) {
    this.sdkPath = options.sdkPath;
    this.startupCwd = options.cwd;
  }

  async start(): Promise<void> {
    this.sdk = await this.loadSdk(this.sdkPath);
    this.agentDir = this.sdk.getAgentDir();
    this.authStorage = this.sdk.AuthStorage.create();

    await this.setActiveSession(this.sdk.SessionManager.continueRecent(this.startupCwd), 'new');

    this.emit('backend.ready', {
      sdkPath: this.sdkPath,
      agentDir: this.agentDir,
      version: this.sdk.VERSION,
    });

    const detachReader = attachJsonlLineReader(process.stdin, (line) => {
      void this.handleLine(line);
    });

    process.stdin.on('end', () => {
      detachReader();
      void this.dispose();
    });
  }

  private async loadSdk(sdkPath: string): Promise<SdkModule> {
    const entryUrl = pathToFileURL(path.join(sdkPath, 'dist', 'index.js')).href;
    return (await dynamicImport(entryUrl)) as SdkModule;
  }

  private createRuntimeFactory() {
    return async ({ cwd, agentDir, sessionManager, sessionStartEvent }: any) => {
      const services = await this.sdk.createAgentSessionServices({
        cwd,
        agentDir,
        authStorage: this.authStorage,
        resourceLoaderOptions: {
          noExtensions: true,
        },
      });

      const created = await this.sdk.createAgentSessionFromServices({
        services,
        sessionManager,
        sessionStartEvent,
      });

      return {
        ...created,
        services,
        diagnostics: services.diagnostics ?? [],
      };
    };
  }

  private async setActiveSession(sessionManager: any, reason: 'new' | 'resume'): Promise<void> {
    const previousSessionFile = this.session?.sessionFile;

    this.unsubscribe?.();
    this.unsubscribe = undefined;

    if (this.runtime) {
      await this.runtime.dispose();
    }

    this.runtime = (await this.sdk.createAgentSessionRuntime(this.createRuntimeFactory(), {
      cwd: sessionManager.getCwd(),
      agentDir: this.agentDir,
      sessionManager,
      sessionStartEvent: previousSessionFile
        ? {
            type: 'session_start',
            reason,
            previousSessionFile,
          }
        : undefined,
    })) as RuntimeLike;

    this.session = this.runtime.session;
    this.activeRequest = undefined;

    this.unsubscribe = this.session.subscribe((event: any) => {
      this.handleSessionEvent(event);
    });

    await this.emitSessionOpened();
    await this.emitSessionListChanged();
    this.emitBusyChanged(this.session.isStreaming);
  }

  private currentSessionPath(): string | undefined {
    return this.session?.sessionFile ?? this.session?.sessionManager.getSessionFile();
  }

  private async deriveNameFromFile(filePath: string): Promise<string> {
    try {
      const content = await fs.readFile(filePath, 'utf8');
      for (const line of content.split('\n')) {
        if (!line.trim()) continue;
        try {
          const entry = JSON.parse(line) as SessionEntryLike;
          if (entry.type === 'message' && entry.message?.role === 'user') {
            const msgContent = entry.message.content;
            const text = typeof msgContent === 'string'
              ? msgContent
              : Array.isArray(msgContent)
                ? (msgContent as Array<{ type?: string; text?: string }>)
                    .filter((p) => p.type === 'text')
                    .map((p) => p.text ?? '')
                    .join('')
                : '';
            const trimmed = text.replace(/\s+/g, ' ').trim();
            if (trimmed) {
              return trimmed.length > 40 ? trimmed.slice(0, 40) + '\u2026' : trimmed;
            }
          }
        } catch {
          // skip malformed lines
        }
      }
    } catch {
      // file not readable
    }
    return 'New Session';
  }

  private async listSessions(): Promise<SessionSummary[]> {
    const sessions = (await this.sdk.SessionManager.listAll()) as Array<any>;
    const summaries = await Promise.all(
      sessions.map(async (session) => {
        const summary = summarizeSession(session);
        if (summary.name === 'New Session' && session.path) {
          summary.name = await this.deriveNameFromFile(session.path);
        }
        return summary;
      }),
    );
    return summaries.sort((left, right) => right.modifiedAt.localeCompare(left.modifiedAt));
  }

  private deriveSessionName(): string {
    const sdkName = this.session?.sessionName || this.session?.sessionManager.getSessionName();
    if (sdkName) return sdkName;

    // Use the first user message text as the tab name
    const entries = this.session?.sessionManager.getBranch() ?? [];
    for (const entry of entries) {
      if (entry.type === 'message' && entry.message?.role === 'user') {
        const content = entry.message.content;
        const text = typeof content === 'string'
          ? content
          : Array.isArray(content)
            ? content.filter((p: any) => p.type === 'text').map((p: any) => p.text ?? '').join('')
            : '';
        const trimmed = text.replace(/\s+/g, ' ').trim();
        if (trimmed) {
          return trimmed.length > 40 ? trimmed.slice(0, 40) + '…' : trimmed;
        }
      }
    }

    return 'New Session';
  }

  private buildCurrentSummary(): SessionSummary {
    const sessionPath = this.currentSessionPath();
    const messageCount = this.session?.messages.length ?? 0;
    return {
      path: sessionPath ?? '',
      cwd: this.session?.sessionManager.getCwd() ?? this.startupCwd,
      name: this.deriveSessionName(),
      modifiedAt: new Date().toISOString(),
      messageCount,
      modelId: this.session?.model?.id,
    };
  }

  private buildTranscript(): ChatMessage[] {
    const entries = this.session?.sessionManager.getBranch() ?? [];
    return mapTranscript(entries);
  }

  private listAvailableModels(): ModelInfo[] {
    try {
      const models = this.runtime?.services?.modelRegistry?.getAvailable() ?? [];
      return models.map((m) => ({
        id: m.id,
        name: m.name,
        provider: m.provider,
        reasoning: m.reasoning,
      }));
    } catch {
      return [];
    }
  }

  private systemPromptSidecarPath(): string | undefined {
    const sessionPath = this.currentSessionPath();
    return sessionPath ? sessionPath + '.prompt.md' : undefined;
  }

  private async readSystemPrompt(): Promise<string | undefined> {
    // Prefer the snapshot written when the session first started — this is what was
    // actually in effect during the session, not whatever the file contains today.
    const sidecar = this.systemPromptSidecarPath();
    if (sidecar) {
      try {
        const snap = await fs.readFile(sidecar, 'utf8');
        if (snap.trim()) return snap.trim();
      } catch {
        // sidecar not written yet — fall through to read live file and create it
      }
    }

    const candidates = ['AGENTS.md', 'agents/AGENTS.md', '.pi/AGENTS.md', 'system-prompt.md'];
    for (const name of candidates) {
      try {
        const text = await fs.readFile(path.join(this.agentDir, name), 'utf8');
        if (text.trim()) {
          // Persist a snapshot so future opens of this session see the same content.
          if (sidecar) {
            await fs.writeFile(sidecar, text, 'utf8').catch(() => undefined);
          }
          return text.trim();
        }
      } catch {
        // not found, try next
      }
    }
    return undefined;
  }

  private async readModelSettings(): Promise<ModelSettings> {
    const defaults: ModelSettings = { defaultModel: '', defaultThinkingLevel: 'medium' };
    try {
      const raw = await fs.readFile(path.join(this.agentDir, 'settings.json'), 'utf8');
      const parsed = JSON.parse(raw) as Partial<ModelSettings>;
      return {
        defaultModel: parsed.defaultModel ?? defaults.defaultModel,
        defaultThinkingLevel: (parsed.defaultThinkingLevel as ThinkingLevel) ?? defaults.defaultThinkingLevel,
      };
    } catch {
      return defaults;
    }
  }

  private async writeModelSettings(updates: Partial<ModelSettings>): Promise<ModelSettings> {
    const settingsPath = path.join(this.agentDir, 'settings.json');
    let existing: Record<string, unknown> = {};
    try {
      existing = JSON.parse(await fs.readFile(settingsPath, 'utf8')) as Record<string, unknown>;
    } catch {
      // may not exist yet
    }
    const merged = { ...existing, ...updates };
    await fs.writeFile(settingsPath, JSON.stringify(merged, null, 2) + '\n', 'utf8');
    return await this.readModelSettings();
  }

  private async emitSessionOpened(): Promise<void> {
    if (!this.session) {
      return;
    }

    const payload: SessionOpenedPayload = {
      session: this.buildCurrentSummary(),
      transcript: this.buildTranscript(),
      busy: this.session.isStreaming,
      systemPrompt: await this.readSystemPrompt(),
      modelSettings: await this.readModelSettings(),
      availableModels: this.listAvailableModels(),
    };
    this.emit('session.opened', payload);
  }

  private async emitSessionListChanged(): Promise<void> {
    const payload: SessionListChangedPayload = {
      sessions: await this.listSessions(),
      activeSessionPath: this.currentSessionPath(),
    };
    this.emit('session.list.changed', payload);
  }

  private emitBusyChanged(busy: boolean): void {
    const payload: BusyChangedPayload = {
      sessionPath: this.currentSessionPath(),
      busy,
    };
    this.emit('busy.changed', payload);
  }

  private emit(event: string, payload?: unknown): void {
    writeStdout({ event, payload });
  }

  private async handleLine(line: string): Promise<void> {
    let request: RequestEnvelope;
    try {
      request = JSON.parse(line) as RequestEnvelope;
    } catch (error) {
      writeStdout(responseError('parse-error', 'PARSE_ERROR', String(error)));
      return;
    }

    try {
      const result = await this.handleRequest(request);
      writeStdout(responseOk(request.id, result));
    } catch (error) {
      const details = extractRequestError(error);
      writeStdout(responseError(request.id, details.code, details.message));
      this.emit('error', details);
    }
  }

  private async ensureActiveSession(sessionPath?: string): Promise<void> {
    if (!sessionPath || sessionPath === this.currentSessionPath()) {
      return;
    }

    await this.setActiveSession(this.sdk.SessionManager.open(sessionPath), 'resume');
  }

  private async handleRequest(request: RequestEnvelope): Promise<unknown> {
    switch (request.method) {
      case 'app.ping':
        return {
          sdkPath: this.sdkPath,
          agentDir: this.agentDir,
          version: this.sdk.VERSION,
        };

      case 'session.list':
        return this.listSessions();

      case 'session.create': {
        const params = (request.params ?? {}) as { cwd?: string };
        const cwd = params.cwd || this.startupCwd;
        await this.setActiveSession(this.sdk.SessionManager.create(cwd), 'new');
        return {
          session: this.buildCurrentSummary(),
          transcript: this.buildTranscript(),
        };
      }

      case 'session.open': {
        const params = (request.params ?? {}) as { sessionPath?: string };
        if (!params.sessionPath) {
          throw new Error('session.open requires a sessionPath');
        }
        await this.setActiveSession(this.sdk.SessionManager.open(params.sessionPath), 'resume');
        return {
          session: this.buildCurrentSummary(),
          transcript: this.buildTranscript(),
          busy: this.session?.isStreaming ?? false,
        };
      }

      case 'message.send': {
        const params = (request.params ?? {}) as { sessionPath?: string; text?: string };
        if (!params.text?.trim()) {
          throw new Error('message.send requires non-empty text');
        }
        if (this.activeRequest || this.session?.isStreaming) {
          throw new Error('A request is already in progress.');
        }

        await this.ensureActiveSession(params.sessionPath);

        const requestId = crypto.randomUUID();
        this.activeRequest = {
          id: requestId,
          messageIndex: 0,
          aborted: false,
        };

        this.emitBusyChanged(true);
        void this.session
          ?.prompt(params.text, { source: 'rpc' })
          .catch((error: Error) => {
            this.emit('error', {
              code: 'MESSAGE_SEND_FAILED',
              message: error.message,
              requestId,
            } satisfies ErrorPayload);
            this.activeRequest = undefined;
            this.emitBusyChanged(false);
          });

        return { requestId };
      }

      case 'message.interrupt': {
        if (this.activeRequest) {
          this.activeRequest.aborted = true;
        }
        await this.session?.abort();
        return { interrupted: true };
      }

      case 'models.list':
        return this.listAvailableModels();

      case 'settings.get':
        return await this.readModelSettings();

      case 'settings.set': {
        const params = (request.params ?? {}) as Partial<ModelSettings>;
        return await this.writeModelSettings(params);
      }

      default:
        throw new Error(`Unknown method: ${request.method}`);
    }
  }

  private handleSessionEvent(event: any): void {
    if (!this.session) {
      return;
    }

    switch (event.type) {
      case 'agent_start': {
        this.emitBusyChanged(true);
        return;
      }

      case 'message_start': {
        if (event.message?.role !== 'assistant' || !this.activeRequest) {
          return;
        }
        this.activeRequest.messageIndex += 1;
        this.activeRequest.currentMessageId = `${this.activeRequest.id}:${this.activeRequest.messageIndex}`;
        this.activeRequest.lastAssistantMessageId = this.activeRequest.currentMessageId;

        this.emit('message.started', {
          requestId: this.activeRequest.id,
          messageId: this.activeRequest.currentMessageId,
          sessionPath: this.currentSessionPath(),
        } satisfies MessageStartedPayload);
        return;
      }

      case 'message_update': {
        if (event.message?.role !== 'assistant' || !this.activeRequest?.currentMessageId) {
          return;
        }

        if (event.assistantMessageEvent?.type === 'text_delta') {
          this.emit('message.delta', {
            requestId: this.activeRequest.id,
            messageId: this.activeRequest.currentMessageId,
            delta: event.assistantMessageEvent.delta,
          } satisfies MessageDeltaPayload);
        }

        if (event.assistantMessageEvent?.type === 'thinking_delta') {
          const thinkingContent: string =
            event.assistantMessageEvent.thinking ?? event.assistantMessageEvent.delta ?? '';
          if (thinkingContent) {
            this.emit('message.thinking', {
              requestId: this.activeRequest.id,
              messageId: this.activeRequest.currentMessageId,
              thinking: thinkingContent,
            } satisfies MessageThinkingPayload);
          }
        }
        return;
      }

      case 'tool_execution_start': {
        if (!this.activeRequest || !this.activeRequest.lastAssistantMessageId) {
          return;
        }

        this.emit('tool.started', {
          requestId: this.activeRequest.id,
          messageId: this.activeRequest.lastAssistantMessageId,
          toolCallId: event.toolCallId,
          name: event.toolName,
          input: event.args,
        } satisfies ToolStartedPayload);
        return;
      }

      case 'tool_execution_end': {
        if (!this.activeRequest || !this.activeRequest.lastAssistantMessageId) {
          return;
        }

        this.emit('tool.finished', {
          requestId: this.activeRequest.id,
          messageId: this.activeRequest.lastAssistantMessageId,
          toolCallId: event.toolCallId,
          result: event.result,
        } satisfies ToolFinishedPayload);
        return;
      }

      case 'message_end': {
        if (event.message?.role !== 'assistant' || !this.activeRequest) {
          return;
        }

        const messageId =
          this.activeRequest.currentMessageId ??
          this.activeRequest.lastAssistantMessageId ??
          `${this.activeRequest.id}:${this.activeRequest.messageIndex + 1}`;

        this.activeRequest.lastAssistantMessageId = messageId;
        this.activeRequest.currentMessageId = undefined;

        const message = mapAssistantMessage(messageId, event.message);
        this.emit('message.finished', {
          requestId: this.activeRequest.id,
          message,
        } satisfies MessageFinishedPayload);

        if (message.status === 'interrupted') {
          this.emit('message.aborted', {
            requestId: this.activeRequest.id,
            messageId,
          } satisfies MessageAbortedPayload);
        }
        return;
      }

      case 'agent_end': {
        const requestId = this.activeRequest?.id;
        const messageId = this.activeRequest?.lastAssistantMessageId;
        const abortedWithoutMessage = this.activeRequest?.aborted && !messageId;

        this.emitBusyChanged(false);

        void this.emitSessionOpened();
        void this.emitSessionListChanged();

        if (requestId && abortedWithoutMessage) {
          this.emit('message.aborted', {
            requestId,
          } satisfies MessageAbortedPayload);
        }

        this.activeRequest = undefined;
        return;
      }

      default:
        return;
    }
  }

  async dispose(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    await this.runtime?.dispose();
  }
}

async function main(): Promise<void> {
  const server = new BackendServer(parseArgs(process.argv.slice(2)));
  await server.start();
}

void main().catch((error) => {
  log(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
