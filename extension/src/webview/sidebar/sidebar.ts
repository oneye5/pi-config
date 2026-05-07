import DOMPurify from 'dompurify';
import { marked } from 'marked';

type ThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

type ModelSettings = {
  defaultModel: string;
  defaultThinkingLevel: ThinkingLevel;
};

type ToolCall = {
  id: string;
  name: string;
  input: unknown;
  result?: unknown;
  status: 'running' | 'completed' | 'failed';
};

type ChatPrefs = {
  autoExpandReasoning: boolean;
  autoExpandToolCalls: boolean;
};

type ChatMessage = {
  id: string;
  role: 'user' | 'assistant' | 'system';
  createdAt: string;
  markdown: string;
  /** Accumulated reasoning content from a thinking model. */
  thinking?: string;
  status: 'streaming' | 'completed' | 'interrupted' | 'error';
  toolCalls?: ToolCall[];
};

type SessionSummary = {
  path: string;
  name: string;
  cwd: string;
  modifiedAt: string;
  messageCount: number;
  modelId?: string;
};

type State = {
  sessions: SessionSummary[];
  hiddenSessionPaths: string[];
  activeSession: SessionSummary | null;
  transcript: ChatMessage[];
  busy: boolean;
  notice: string | null;
  workspaceCwd: string | null;
  systemPrompt: string | null;
  modelSettings: ModelSettings | null;
  availableModels: { id: string; name: string; provider: string; reasoning: boolean }[];
};

// Common models for the picker are loaded dynamically from the backend.
// No hardcoded list — see state.availableModels.

const THINKING_LEVELS: ThinkingLevel[] = ['off', 'low', 'medium', 'high', 'xhigh'];

declare function acquireVsCodeApi(): {
  postMessage: (message: unknown) => void;
};

const vscode = acquireVsCodeApi();

const PREFS_KEY = 'pi-chat-prefs';

function loadPrefs(): ChatPrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<ChatPrefs>) : {};
    return {
      autoExpandReasoning: parsed.autoExpandReasoning ?? false,
      autoExpandToolCalls: parsed.autoExpandToolCalls ?? false,
    };
  } catch {
    return { autoExpandReasoning: false, autoExpandToolCalls: false };
  }
}

function savePrefs(prefs: ChatPrefs): void {
  localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
}

let chatPrefs: ChatPrefs = loadPrefs();

const state: State = {
  sessions: [],
  hiddenSessionPaths: [],
  activeSession: null,
  transcript: [],
  busy: false,
  notice: null,
  workspaceCwd: null,
  systemPrompt: null,
  modelSettings: null,
  availableModels: [],
};

marked.setOptions({ gfm: true, breaks: true });

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function formatDate(value: string): string {
  return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatJson(value: unknown): string {
  if (typeof value === 'string') return value;
  return JSON.stringify(value, null, 2) ?? '';
}

function renderMarkdown(markdown: string, status: ChatMessage['status'], hasThinking?: boolean): string {
  if (!markdown.trim() && status === 'streaming') {
    // If a thinking block is present, it already shows activity — skip the generic spinner.
    if (hasThinking) return '';
    return '<div class="thinking-inline"><span class="spinner"></span><span>Working\u2026</span></div>';
  }
  if (status === 'streaming') {
    // Avoid marked.parse overhead every frame — plain text with cursor, styled pre-wrap.
    return `<span class="streaming-text">${escapeHtml(markdown)}</span><span class="cursor"></span>`;
  }
  return DOMPurify.sanitize(String(marked.parse(markdown || '')));
}

function thinkingPreview(thinking: string | undefined): string {
  if (!thinking) return 'Reasoning\u2026';
  // Strip markdown syntax and leading list markers, then take first non-empty line.
  const plain = thinking.replace(/[#*_`>]/g, '').trim();
  const firstLine = plain.split('\n').find((l) => l.trim()) ?? plain;
  // Remove leading list marker (-, *, +) that slipped through.
  const snippet = firstLine.trim().replace(/^[-*+]\s*/, '').slice(0, 80);
  return snippet.length < firstLine.trim().replace(/^[-*+]\s*/, '').length ? `${snippet}\u2026` : snippet;
}

function thinkingTooltip(thinking: string | undefined): string {
  return thinking ? truncate(thinking.replace(/[#*_`>]/g, ''), TOOLTIP_RESULT_MAX) : '';
}

function renderThinkingPreview(thinking: string | undefined): string {
  return thinking ? `<span class="thinking-label">${renderCommandPreview(thinkingPreview(thinking))}</span>` : '';
}

function renderThinking(thinking: string | undefined, status: ChatMessage['status']): string {
  // Only show on assistant messages while streaming, or when thinking content exists.
  if (!thinking && status !== 'streaming') return '';
  const isStreaming = status === 'streaming';
  let bodyHtml = '';
  if (thinking) {
    const content = isStreaming
      ? `<span class="streaming-text">${escapeHtml(thinking)}</span><span class="cursor"></span>`
      : DOMPurify.sanitize(String(marked.parse(thinking)));
    bodyHtml = `<div class="tool-details-body thinking-body">${content}</div>`;
  }
  // Match tool-call tooltip pattern: show truncated content on hover.
  const tooltip = thinkingTooltip(thinking);
  const titleAttr = tooltip ? ` title="${escapeHtml(tooltip)}"` : '';
  return `
    <details class="tool-call tool-call-details thinking-block">
      <summary${titleAttr}>
        <span class="tool-summary-left">
          <span class="tool-chevron">&#9658;</span>
          ${isStreaming && !thinking ? '<span class="spinner"></span>' : ''}
          <span class="tool-name thinking-name">Reasoning</span>
          ${renderThinkingPreview(thinking)}
        </span>
      </summary>
      ${bodyHtml}
    </details>
  `;
}

const COMMAND_PREVIEW_MAX = 72;
const TOOLTIP_RESULT_MAX = 400;

function renderCommandPreview(preview: string): string {
  const spaceIdx = preview.indexOf(' ');
  if (spaceIdx === -1) {
    return `<span class="tool-command tool-command-verb">${escapeHtml(preview)}</span>`;
  }
  const verb = preview.slice(0, spaceIdx);
  const args = preview.slice(spaceIdx);
  return `<span class="tool-command tool-command-verb">${escapeHtml(verb)}</span><span class="tool-command tool-command-args">${escapeHtml(args)}</span>`;
}

function truncate(text: string, max: number): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  return normalized.length > max ? normalized.slice(0, max) + '…' : normalized;
}

function extractCommandPreview(input: unknown): string {
  if (typeof input === 'string') {
    return input;
  }

  if (input && typeof input === 'object') {
    const record = input as Record<string, unknown>;
    const preferredKeys = ['command', 'cmd', 'query', 'path', 'file', 'url', 'input', 'text', 'content', 'message'];

    for (const key of preferredKeys) {
      const value = record[key];
      if (typeof value === 'string' && value.length > 0) {
        return value;
      }
    }

    for (const value of Object.values(record)) {
      if (typeof value === 'string' && value.length > 0) {
        return value;
      }
    }
  }

  return '';
}

// ─── System Prompt ────────────────────────────────────────────────────────────────

function renderSystemPrompt(): string {
  if (!state.systemPrompt) return '';
  const html = DOMPurify.sanitize(String(marked.parse(state.systemPrompt)));
  return `
    <details class="system-prompt-card">
      <summary>
        <span class="tool-summary-left">
          <span class="tool-chevron">▶</span>
          <span class="system-prompt-label">System Prompt</span>
        </span>
      </summary>
      <div class="system-prompt-body">${html}</div>
    </details>
  `;
}

// ─── Tool Calls ───────────────────────────────────────────

function renderToolCall(toolCall: ToolCall): string {
  const hasDetails = toolCall.input !== undefined || toolCall.result !== undefined;
  const preview = truncate(extractCommandPreview(toolCall.input), COMMAND_PREVIEW_MAX);
  const tooltip = toolCall.result !== undefined
    ? truncate(formatJson(toolCall.result), TOOLTIP_RESULT_MAX)
    : preview;
  const titleAttr = tooltip ? ` title="${escapeHtml(tooltip)}"` : '';

  const inner = `
    <span class="tool-summary-left">
      <span class="tool-chevron">▶</span>
      ${toolCall.status === 'running' ? '<span class="spinner"></span>' : ''}
      <span class="tool-name">${escapeHtml(toolCall.name)}</span>
      ${preview ? renderCommandPreview(preview) : ''}
    </span>
    ${toolCall.status === 'failed' ? `<span class="tool-status failed">failed</span>` : ''}
  `;

  if (!hasDetails) {
    return `<div class="tool-call ${toolCall.status}" data-tool-call-id="${escapeHtml(toolCall.id)}"${titleAttr}>${inner}</div>`;
  }

  return `
    <details class="tool-call tool-call-details ${toolCall.status}" data-tool-call-id="${escapeHtml(toolCall.id)}">
      <summary${titleAttr}>${inner}</summary>
      <div class="tool-details-body">
        <div class="tool-section-label">Input</div>
        <pre><code>${escapeHtml(formatJson(toolCall.input))}</code></pre>
        ${toolCall.result !== undefined ? `<div class="tool-section-label">Result</div><pre><code>${escapeHtml(formatJson(toolCall.result))}</code></pre>` : ''}
      </div>
    </details>
  `;
}

// ─── Messages ─────────────────────────────────────────────

function renderMessage(message: ChatMessage, showTime: boolean): string {
  // Skip empty messages with no tool calls (e.g. blank assistant turns)
  const hasContent = message.markdown.trim() || message.thinking || (message.toolCalls && message.toolCalls.length > 0);
  if (!hasContent && message.status === 'completed') return '';

  const toolsHtml = message.toolCalls && message.toolCalls.length > 0
    ? `<div class="tool-list">${message.toolCalls.map(renderToolCall).join('')}</div>`
    : '';

  const statusBadge = message.status !== 'completed' && message.status !== 'streaming'
    ? `<span class="status-pill">${escapeHtml(message.status)}</span>`
    : '';

  const hasText = message.markdown.trim();
  const timeHtml = `<span class="message-time">${escapeHtml(formatDate(message.createdAt))}</span>`;

  // User timestamp floats above the bubble (outside the article) so short messages
  // don't become disproportionately tall just from the timestamp row.
  const outerTopTime = message.role === 'user' && showTime
    ? `<div class="message-time-row top">${timeHtml}${statusBadge}</div>`
    : '';

  // Non-user status badges (e.g. "interrupted") stay inside the bubble at the top.
  const innerTopBadge = message.role !== 'user' && statusBadge
    ? `<div class="message-time-row top">${statusBadge}</div>`
    : '';

  const bottomTime = message.role === 'assistant' && showTime
    ? `<div class="message-time-row bottom">${timeHtml}</div>`
    : '';

  // Reasoning block (assistant only — shown before the reply text).
  const thinkingHtml = message.role === 'assistant'
    ? renderThinking(message.thinking, message.status)
    : '';

  const bodyHtml = hasText || (message.role === 'assistant' && message.status === 'streaming')
    ? `<div class="message-body">${renderMarkdown(message.markdown, message.status, !!message.thinking)}</div>`
    : '';

  return `
    <div class="message-wrapper ${message.role}" data-message-id="${escapeHtml(message.id)}">
      ${outerTopTime}
      <article class="message ${message.role}">
        ${innerTopBadge}
        ${thinkingHtml}
        ${bodyHtml}
        ${toolsHtml ? `<div class="message-tools">${toolsHtml}</div>` : ''}
        ${bottomTime}
      </article>
    </div>
  `;
}

// ─── Session Tabs ──────────────────────────────────────────

function renderSessionTab(session: SessionSummary): string {
  const active = session.path === state.activeSession?.path;
  const thinking = active && state.busy;
  const dotClass = thinking ? 'thinking-state' : active ? 'active-state' : '';
  // Use the richer derived name for the active tab (comes from session.opened, not the list)
  const displayName = active && state.activeSession ? state.activeSession.name : session.name;
  return `
    <div class="session-tab ${active ? 'active' : ''}" data-session-path="${escapeHtml(session.path)}">
      <button class="tab-body" data-open-session="${escapeHtml(session.path)}" title="${escapeHtml(displayName)} \u2014 ${escapeHtml(session.cwd)}">
        <span class="tab-status-dot ${dotClass}"></span>
        <span class="tab-name">${escapeHtml(displayName)}</span>
      </button>
      <button class="tab-close" data-close-session="${escapeHtml(session.path)}" title="Close">&#x2715;</button>
    </div>
  `;
}

function renderSessionTabs(): string {
  const hidden = new Set(state.hiddenSessionPaths);
  const thisProject = state.sessions.filter(
    (session) => session.cwd === state.workspaceCwd && !hidden.has(session.path),
  );
  const activeElsewhere = state.activeSession?.cwd !== state.workspaceCwd ? state.activeSession : null;
  const tabs = activeElsewhere
    ? [activeElsewhere, ...thisProject.filter((session) => session.path !== activeElsewhere.path)]
    : thisProject;

  const tabHtml = [...tabs]
    .sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt))
    .map(renderSessionTab)
    .join('');

  return `${tabHtml}<button class="tab-new-btn" id="new-session-btn" title="New session">+</button>`;
}

// ─── Empty state ───────────────────────────────────────────

function renderEmptyChat(): string {
  if (!state.activeSession) {
    return `
      <div class="empty-chat">
        <div class="empty-title">No active session</div>
        <div class="empty-desc">Press + to create a new session.</div>
      </div>
    `;
  }
  return `
    <div class="empty-chat">
      <div class="empty-title">${escapeHtml(state.activeSession.name)}</div>
      <div class="empty-desc">${escapeHtml(state.activeSession.cwd)}</div>
    </div>
  `;
}

// ─── Render ────────────────────────────────────────────────

let initialized = false;

/**
 * Build the static layout skeleton and bind all event listeners once.
 * Called on first render; subsequent renders only patch region innerHTML.
 */
function initLayout(): void {
  const app = document.getElementById('app');
  if (!app) return;

  app.innerHTML = `
    <div class="layout">
      <div id="banner-region" style="display:none"></div>
      <div class="tab-bar" id="tab-bar"></div>
      <main class="messages" id="messages"></main>
      <footer class="composer">
        <textarea id="composer-input" placeholder="Ask PI Assistant…" rows="2"></textarea>
        <div class="composer-actions">
          <div class="model-picker" id="model-picker-region">
            <select id="model-select" class="model-select" title="Model"></select>
            <select id="thinking-select" class="thinking-select" title="Reasoning effort"></select>
          </div>
          <button class="composer-toggle" id="toggle-reasoning" aria-pressed="false" title="Auto-expand reasoning blocks as they stream in">
            <span class="toggle-dot"></span>Reasoning
          </button>
          <button class="composer-toggle" id="toggle-tools" aria-pressed="false" title="Auto-expand tool calls as they appear">
            <span class="toggle-dot"></span>Tools
          </button>
          <button class="composer-button primary" id="action-btn"></button>
        </div>
      </footer>
    </div>
  `;

  // Tab bar — use event delegation so innerHTML replacements don't break listeners
  document.getElementById('tab-bar')!.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const openBtn = target.closest<HTMLElement>('[data-open-session]');
    const closeBtn = target.closest<HTMLElement>('[data-close-session]');
    const newBtn = target.closest<HTMLElement>('#new-session-btn');
    if (openBtn?.dataset.openSession) vscode.postMessage({ type: 'openSession', sessionPath: openBtn.dataset.openSession });
    else if (closeBtn?.dataset.closeSession) vscode.postMessage({ type: 'closeSession', sessionPath: closeBtn.dataset.closeSession });
    else if (newBtn) vscode.postMessage({ type: 'newSession' });
  });

  // Chat preference toggles
  const syncToggleUi = (): void => {
    const reasoningBtn = document.getElementById('toggle-reasoning') as HTMLButtonElement | null;
    const toolsBtn = document.getElementById('toggle-tools') as HTMLButtonElement | null;
    if (reasoningBtn) reasoningBtn.setAttribute('aria-pressed', String(chatPrefs.autoExpandReasoning));
    if (toolsBtn) toolsBtn.setAttribute('aria-pressed', String(chatPrefs.autoExpandToolCalls));
  };
  syncToggleUi();

  document.getElementById('toggle-reasoning')!.addEventListener('click', () => {
    chatPrefs = { ...chatPrefs, autoExpandReasoning: !chatPrefs.autoExpandReasoning };
    savePrefs(chatPrefs);
    syncToggleUi();
    const msgs = document.getElementById('messages');
    if (msgs) {
      for (const el of Array.from(msgs.querySelectorAll<HTMLDetailsElement>('.thinking-block'))) {
        el.open = chatPrefs.autoExpandReasoning;
      }
    }
  });

  document.getElementById('toggle-tools')!.addEventListener('click', () => {
    chatPrefs = { ...chatPrefs, autoExpandToolCalls: !chatPrefs.autoExpandToolCalls };
    savePrefs(chatPrefs);
    syncToggleUi();
    const msgs = document.getElementById('messages');
    if (msgs) {
      for (const el of Array.from(msgs.querySelectorAll<HTMLDetailsElement>('.tool-call-details:not(.thinking-block)'))) {
        el.open = chatPrefs.autoExpandToolCalls;
      }
    }
  });

  // Model picker
  document.getElementById('model-select')!.addEventListener('change', (e) => {
    const newModel = (e.target as HTMLSelectElement).value;
    const known = state.availableModels.find((m) => m.id === newModel);
    const level = state.modelSettings?.defaultThinkingLevel ?? 'medium';
    const newLevel: ThinkingLevel = known && !known.reasoning ? 'off' : level;
    vscode.postMessage({ type: 'setModel', defaultModel: newModel, defaultThinkingLevel: newLevel });
  });

  document.getElementById('thinking-select')!.addEventListener('change', (e) => {
    const level = (e.target as HTMLSelectElement).value as ThinkingLevel;
    vscode.postMessage({ type: 'setModel', defaultModel: state.modelSettings?.defaultModel ?? '', defaultThinkingLevel: level });
  });

  // Composer
  const textarea = document.getElementById('composer-input') as HTMLTextAreaElement;
  const actionBtn = document.getElementById('action-btn') as HTMLButtonElement;

  const send = (): void => {
    if (!textarea.value.trim() || state.busy) return;
    const text = textarea.value;
    textarea.value = '';
    textarea.style.height = 'auto';
    vscode.postMessage({ type: 'send', text });
  };

  actionBtn.addEventListener('click', () => {
    if (state.busy) vscode.postMessage({ type: 'interrupt' });
    else send();
  });
  textarea.addEventListener('input', () => {
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 140) + 'px';
  });
  textarea.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      send();
    }
  });

  initialized = true;
}

function updateBanner(): void {
  const region = document.getElementById('banner-region') as HTMLElement | null;
  if (!region) return;
  if (state.notice) {
    region.className = 'banner';
    region.textContent = state.notice;
    region.style.display = '';
  } else {
    region.className = '';
    region.textContent = '';
    region.style.display = 'none';
  }
}

function updateTabBar(): void {
  const tabBar = document.getElementById('tab-bar');
  if (tabBar) tabBar.innerHTML = renderSessionTabs();
}

function updateMessages(): void {
  const messages = document.getElementById('messages');
  if (!messages) return;

  const atBottom = messages.scrollHeight - messages.scrollTop - messages.clientHeight < 80;

  // Preserve open states of <details> elements before replacing innerHTML
  const openToolCallIds = new Set<string>();
  const openThinkingMsgIds = new Set<string>();
  let systemPromptOpen = false;
  for (const el of Array.from(messages.querySelectorAll<HTMLDetailsElement>('details[open]'))) {
    if (el.classList.contains('system-prompt-card')) {
      systemPromptOpen = true;
    } else if (el.classList.contains('thinking-block')) {
      const msgWrapper = el.closest<HTMLElement>('[data-message-id]');
      if (msgWrapper?.dataset.messageId) openThinkingMsgIds.add(msgWrapper.dataset.messageId);
    } else {
      const id = (el as HTMLElement).dataset.toolCallId;
      if (id) openToolCallIds.add(id);
    }
  }

  const visibleMessages = state.transcript.filter((m) => {
    const hasContent = m.markdown.trim() || (m.toolCalls && m.toolCalls.length > 0);
    return hasContent || m.status !== 'completed';
  });

  let lastCompletedAssistantId: string | null = null;
  for (let i = visibleMessages.length - 1; i >= 0; i--) {
    const m = visibleMessages[i];
    if (m.role === 'assistant' && m.status === 'completed') {
      lastCompletedAssistantId = m.id;
      break;
    }
  }

  messages.innerHTML = `
    ${renderSystemPrompt()}
    ${visibleMessages.length > 0
      ? visibleMessages.map((m) => renderMessage(m, m.role === 'user' || m.id === lastCompletedAssistantId)).join('')
      : renderEmptyChat()}
  `;

  // Restore open states
  if (systemPromptOpen) {
    const el = messages.querySelector<HTMLDetailsElement>('.system-prompt-card');
    if (el) el.open = true;
  }
  for (const id of openToolCallIds) {
    const el = messages.querySelector<HTMLElement>(`[data-tool-call-id="${CSS.escape(id)}"]`);
    if (el?.tagName === 'DETAILS') (el as HTMLDetailsElement).open = true;
  }
  for (const mid of openThinkingMsgIds) {
    const el = messages.querySelector<HTMLDetailsElement>(`[data-message-id="${CSS.escape(mid)}"] .thinking-block`);
    if (el) el.open = true;
  }

  if (atBottom) messages.scrollTop = messages.scrollHeight;
}

function updateModelPicker(): void {
  const modelSelect = document.getElementById('model-select') as HTMLSelectElement | null;
  const thinkingSelect = document.getElementById('thinking-select') as HTMLSelectElement | null;
  const pickerRegion = document.getElementById('model-picker-region') as HTMLElement | null;
  if (!modelSelect || !thinkingSelect || !pickerRegion) return;

  const ms = state.modelSettings;
  pickerRegion.style.display = ms !== null || state.activeSession !== null ? '' : 'none';

  const currentModel = ms?.defaultModel ?? '';
  const currentThinking = ms?.defaultThinkingLevel ?? 'medium';
  const models = state.availableModels;
  const known = models.find((m) => m.id === currentModel);
  const supportsThinking = known?.reasoning ?? true;

  // Update model <select> options
  const grouped = new Map<string, typeof models>();
  for (const m of models) {
    const list = grouped.get(m.provider) ?? [];
    list.push(m);
    grouped.set(m.provider, list);
  }

  let modelOptions: string;
  if (models.length === 0) {
    modelOptions = `<option value="${escapeHtml(currentModel)}">${escapeHtml(currentModel || 'Loading…')}</option>`;
  } else {
    const parts: string[] = [];
    if (currentModel && !known) {
      parts.push(`<option value="${escapeHtml(currentModel)}">${escapeHtml(currentModel)}</option>`);
    }
    for (const [provider, providerModels] of grouped) {
      const label = escapeHtml(provider);
      const opts = providerModels
        .map((m) => `<option value="${escapeHtml(m.id)}">${escapeHtml(m.name || m.id)}</option>`)
        .join('');
      parts.push(grouped.size > 1 ? `<optgroup label="${label}">${opts}</optgroup>` : opts);
    }
    modelOptions = parts.join('');
  }
  modelSelect.innerHTML = modelOptions;
  modelSelect.value = currentModel;

  // Update thinking <select> options
  thinkingSelect.innerHTML = THINKING_LEVELS.map((level) => `<option value="${level}">${level}</option>`).join('');
  thinkingSelect.value = currentThinking;
  thinkingSelect.disabled = !supportsThinking;
}

function updateComposerState(): void {
  const textarea = document.getElementById('composer-input') as HTMLTextAreaElement | null;
  const actionBtn = document.getElementById('action-btn') as HTMLButtonElement | null;
  if (!textarea || !actionBtn) return;

  textarea.disabled = !state.activeSession;

  if (state.busy) {
    actionBtn.textContent = 'Interrupt';
    actionBtn.className = 'composer-button';
    actionBtn.disabled = false;
  } else {
    actionBtn.textContent = 'Send';
    actionBtn.className = 'composer-button primary';
    actionBtn.disabled = !state.activeSession;
  }
}

function render(): void {
  if (!initialized) initLayout();
  updateBanner();
  updateTabBar();
  updateMessages();
  updateModelPicker();
  updateComposerState();
}


// ─── Incremental streaming DOM updates ────────────────────

function scrollIfAtBottom(): void {
  const messages = document.getElementById('messages');
  if (!messages) return;
  const atBottom = messages.scrollHeight - messages.scrollTop - messages.clientHeight < 80;
  if (atBottom) messages.scrollTop = messages.scrollHeight;
}

// ─── RAF-batched streaming updates ────────────────────────
// Batch DOM content updates to once per animation frame for smooth streaming.

let streamRafId: number | null = null;
const pendingStreamUpdates = new Set<string>(); // message IDs awaiting content flush

function scheduleStreamFlush(): void {
  if (streamRafId !== null) return;
  streamRafId = requestAnimationFrame(flushStreamUpdates);
}

function flushStreamUpdates(): void {
  streamRafId = null;
  for (const messageId of pendingStreamUpdates) {
    const msg = state.transcript.find((m) => m.id === messageId);
    if (!msg) continue;
    const wrapper = document.querySelector(`[data-message-id="${CSS.escape(messageId)}"]`);
    if (!wrapper) continue;

    const isStreaming = msg.status === 'streaming';

    // Update message body — plain text during streaming for zero-cost frame updates
    const bodyEl = wrapper.querySelector<HTMLElement>('.message-body');
    if (bodyEl) {
      if (isStreaming) {
        bodyEl.innerHTML = `<span class="streaming-text">${escapeHtml(msg.markdown || '')}</span><span class="cursor"></span>`;
      } else {
        bodyEl.innerHTML = DOMPurify.sanitize(String(marked.parse(msg.markdown || '')));
      }
    }

    // Update thinking block
    const thinkingBlock = wrapper.querySelector<HTMLDetailsElement>('.thinking-block');
    if (thinkingBlock && msg.thinking) {
      const summaryEl = thinkingBlock.querySelector<HTMLElement>('summary');
      const summaryLeftEl = thinkingBlock.querySelector<HTMLElement>('.tool-summary-left');
      const thinkingBodyEl = thinkingBlock.querySelector<HTMLElement>('.thinking-body');
      if (summaryEl) {
        const tooltip = thinkingTooltip(msg.thinking);
        if (tooltip) summaryEl.title = tooltip;
        else summaryEl.removeAttribute('title');
      }
      if (summaryLeftEl) {
        summaryLeftEl.querySelector('.spinner')?.remove();
        let labelEl = summaryLeftEl.querySelector<HTMLElement>('.thinking-label');
        if (!labelEl) {
          labelEl = document.createElement('span');
          labelEl.className = 'thinking-label';
          summaryLeftEl.appendChild(labelEl);
        }
        labelEl.innerHTML = renderCommandPreview(thinkingPreview(msg.thinking));
      }
      if (thinkingBodyEl) {
        if (isStreaming) {
          thinkingBodyEl.innerHTML = `<span class="streaming-text">${escapeHtml(msg.thinking)}</span><span class="cursor"></span>`;
        } else {
          thinkingBodyEl.innerHTML = DOMPurify.sanitize(String(marked.parse(msg.thinking)));
        }
      }
    }
  }
  pendingStreamUpdates.clear();
  scrollIfAtBottom();
}

/**
 * Append a text delta to an actively-streaming message without a full re-render.
 * Batches DOM updates via requestAnimationFrame for smooth rendering.
 * Falls back to full render if the element is not in the DOM yet.
 */
function applyTextDelta(messageId: string, delta: string): void {
  const msg = state.transcript.find((m) => m.id === messageId);
  if (msg) msg.markdown = `${msg.markdown}${delta}`;

  const wrapper = document.querySelector(`[data-message-id="${CSS.escape(messageId)}"]`);
  if (!wrapper) { render(); return; }

  // Ensure .message-body exists so flushStreamUpdates can target it
  if (!wrapper.querySelector('.message-body')) {
    const article = wrapper.querySelector('article');
    if (article) {
      const div = document.createElement('div');
      div.className = 'message-body';
      const anchor = article.querySelector('.message-tools, .message-time-row.bottom');
      article.insertBefore(div, anchor ?? null);
    }
  }

  pendingStreamUpdates.add(messageId);
  scheduleStreamFlush();
}

/**
 * Append thinking content to an actively-streaming message without a full re-render.
 * Batches DOM updates via requestAnimationFrame for smooth rendering.
 */
function applyThinkingDelta(messageId: string, thinking: string): void {
  const msg = state.transcript.find((m) => m.id === messageId);
  if (msg) msg.thinking = `${msg.thinking ?? ''}${thinking}`;

  const wrapper = document.querySelector(`[data-message-id="${CSS.escape(messageId)}"]`);
  if (!wrapper) { render(); return; }

  // Ensure thinking block exists so flushStreamUpdates can target it
  if (!wrapper.querySelector('.thinking-block')) {
    const article = wrapper.querySelector('article');
    if (!article) return;
    const detailsEl = document.createElement('details');
    detailsEl.className = 'tool-call tool-call-details thinking-block';
    if (chatPrefs.autoExpandReasoning) detailsEl.open = true;
    detailsEl.innerHTML = `
      <summary>
        <span class="tool-summary-left">
          <span class="tool-chevron">&#9658;</span>
          <span class="spinner"></span>
          <span class="tool-name thinking-name">Reasoning</span>
        </span>
      </summary>
      <div class="tool-details-body thinking-body"></div>
    `;
    const anchor = article.querySelector('.message-body, .message-tools, .message-time-row.bottom');
    article.insertBefore(detailsEl, anchor ?? null);
  }

  pendingStreamUpdates.add(messageId);
  scheduleStreamFlush();
}

/**
 * Patch a single tool call row without touching the rest of the message DOM.
 * Falls back to full render if the message wrapper is not yet in the DOM.
 */
function applyToolCallUpdate(messageId: string, toolCall: ToolCall): void {
  // Keep the in-memory transcript in sync.
  const msg = state.transcript.find((m) => m.id === messageId);
  if (msg) {
    const existing = msg.toolCalls ?? [];
    const idx = existing.findIndex((tc) => tc.id === toolCall.id);
    if (idx === -1) {
      msg.toolCalls = [...existing, toolCall];
    } else {
      msg.toolCalls = existing.map((tc) => (tc.id === toolCall.id ? toolCall : tc));
    }
  }

  const wrapper = document.querySelector(`[data-message-id="${CSS.escape(messageId)}"]`);
  if (!wrapper) { render(); return; }

  const article = wrapper.querySelector('article');
  if (!article) { render(); return; }

  // Ensure the .message-tools > .tool-list container exists.
  let toolsDiv = article.querySelector<HTMLElement>('.message-tools');
  if (!toolsDiv) {
    toolsDiv = document.createElement('div');
    toolsDiv.className = 'message-tools';
    const anchor = article.querySelector('.message-time-row.bottom');
    article.insertBefore(toolsDiv, anchor ?? null);
  }
  let listDiv = toolsDiv.querySelector<HTMLElement>('.tool-list');
  if (!listDiv) {
    listDiv = document.createElement('div');
    listDiv.className = 'tool-list';
    toolsDiv.appendChild(listDiv);
  }

  // Find or create the tool-call row for this tool call id.
  const rowId = `tool-${CSS.escape(toolCall.id)}`;
  let rowEl = listDiv.querySelector<HTMLElement>(`[data-tool-call-id="${CSS.escape(toolCall.id)}"]`);
  const newHtml = renderToolCall(toolCall);
  if (!rowEl) {
    const placeholder = document.createElement('div');
    placeholder.innerHTML = newHtml;
    const newRow = placeholder.firstElementChild as HTMLElement | null;
    if (newRow) {
      newRow.dataset.toolCallId = toolCall.id;
      if (chatPrefs.autoExpandToolCalls && newRow.tagName === 'DETAILS') (newRow as HTMLDetailsElement).open = true;
      listDiv.appendChild(newRow);
    }
  } else {
    const isDetails = rowEl.tagName === 'DETAILS';
    const wasOpen = isDetails && (rowEl as HTMLDetailsElement).open;
    const placeholder = document.createElement('div');
    placeholder.innerHTML = newHtml;
    const newRow = placeholder.firstElementChild as HTMLElement | null;
    if (newRow) {
      newRow.dataset.toolCallId = toolCall.id;
      rowEl.replaceWith(newRow);
      if (newRow.tagName === 'DETAILS') {
        (newRow as HTMLDetailsElement).open = wasOpen || chatPrefs.autoExpandToolCalls;
      }
    }
  }
  scrollIfAtBottom();
}

window.addEventListener('message', (event) => {
  if (event.data?.type === 'state') {
    Object.assign(state, event.data.state as State);
    render();
    return;
  }
  if (event.data?.type === 'delta') {
    applyTextDelta(event.data.messageId as string, event.data.delta as string);
    return;
  }
  if (event.data?.type === 'thinking') {
    applyThinkingDelta(event.data.messageId as string, event.data.thinking as string);
    return;
  }
  if (event.data?.type === 'toolCall') {
    applyToolCallUpdate(event.data.messageId as string, event.data.toolCall as ToolCall);
    return;
  }
});

window.addEventListener('DOMContentLoaded', () => {
  render();
  vscode.postMessage({ type: 'ready' });
});


