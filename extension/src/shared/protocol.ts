export interface RequestEnvelope<TParams = unknown> {
  id: string;
  method: string;
  params?: TParams;
}

export type ResponseEnvelope<TResult = unknown> =
  | {
      id: string;
      ok: true;
      result?: TResult;
    }
  | {
      id: string;
      ok: false;
      error: {
        code: string;
        message: string;
        data?: unknown;
      };
    };

export interface EventEnvelope<TPayload = unknown> {
  event: string;
  payload?: TPayload;
}

export type ThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

export interface ModelSettings {
  defaultModel: string;
  defaultThinkingLevel: ThinkingLevel;
}

export interface ModelInfo {
  id: string;
  name: string;
  provider: string;
  reasoning: boolean;
}

export interface SessionSummary {
  path: string;
  name: string;
  cwd: string;
  modifiedAt: string;
  messageCount: number;
  modelId?: string;
}

export interface ToolCall {
  id: string;
  name: string;
  input: unknown;
  result?: unknown;
  status: 'running' | 'completed' | 'failed';
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  createdAt: string;
  markdown: string;
  /** Accumulated reasoning/thinking content (only present on assistant messages from reasoning models). */
  thinking?: string;
  status: 'streaming' | 'completed' | 'interrupted' | 'error';
  toolCalls?: ToolCall[];
}

export interface BackendReadyPayload {
  sdkPath: string;
  agentDir: string;
  version: string;
}

export interface SessionOpenedPayload {
  session: SessionSummary;
  transcript: ChatMessage[];
  busy: boolean;
  systemPrompt?: string;
  modelSettings?: ModelSettings;
  availableModels?: ModelInfo[];
}

export interface SessionListChangedPayload {
  sessions: SessionSummary[];
  activeSessionPath?: string;
}

export interface MessageStartedPayload {
  requestId: string;
  messageId: string;
  sessionPath?: string;
}

export interface MessageDeltaPayload {
  requestId: string;
  messageId: string;
  delta: string;
}

export interface MessageThinkingPayload {
  requestId: string;
  messageId: string;
  thinking: string;
}

export interface ToolStartedPayload {
  requestId: string;
  messageId: string;
  toolCallId: string;
  name: string;
  input: unknown;
}

export interface ToolFinishedPayload {
  requestId: string;
  messageId: string;
  toolCallId: string;
  result: unknown;
}

export interface MessageFinishedPayload {
  requestId: string;
  message: ChatMessage;
}

export interface MessageAbortedPayload {
  requestId: string;
  messageId?: string;
}

export interface BusyChangedPayload {
  sessionPath?: string;
  busy: boolean;
}

export interface ErrorPayload {
  code: string;
  message: string;
  requestId?: string;
}

export function isEventEnvelope(value: unknown): value is EventEnvelope {
  return !!value && typeof value === 'object' && 'event' in value;
}

export function isResponseEnvelope(value: unknown): value is ResponseEnvelope {
  return !!value && typeof value === 'object' && 'id' in value && 'ok' in value;
}

// Known common models grouped by provider for the UI picker.
// Extend this list as needed; the user can also type a custom model ID.
export const KNOWN_MODELS: { id: string; label: string; provider: string; thinking: boolean }[] = [
  // GitHub Copilot
  { id: 'gpt-5.4-mini',           label: 'GPT-5.4 mini',       provider: 'github-copilot', thinking: false },
  { id: 'gpt-4.5',                label: 'GPT-4.5',             provider: 'github-copilot', thinking: false },
  { id: 'claude-sonnet-4-5',      label: 'Claude Sonnet 4.5',  provider: 'github-copilot', thinking: true },
  { id: 'claude-opus-4-5',        label: 'Claude Opus 4.5',    provider: 'github-copilot', thinking: true },
  { id: 'o4-mini',                label: 'o4-mini',             provider: 'github-copilot', thinking: true },
  { id: 'o3',                     label: 'o3',                  provider: 'github-copilot', thinking: true },
  // Anthropic direct
  { id: 'claude-opus-4-5',        label: 'Claude Opus 4.5',    provider: 'anthropic', thinking: true },
  { id: 'claude-sonnet-4-5',      label: 'Claude Sonnet 4.5',  provider: 'anthropic', thinking: true },
  { id: 'claude-haiku-3-5',       label: 'Claude Haiku 3.5',   provider: 'anthropic', thinking: false },
  // OpenAI direct
  { id: 'gpt-4o',                 label: 'GPT-4o',              provider: 'openai', thinking: false },
  { id: 'o3',                     label: 'o3',                  provider: 'openai', thinking: true },
  { id: 'o4-mini',                label: 'o4-mini',             provider: 'openai', thinking: true },
];
