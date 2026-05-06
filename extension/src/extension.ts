import * as cp from 'child_process';
import * as http from 'http';
import * as vscode from 'vscode';

const WEBUI_URL = 'http://127.0.0.1:8787';
const WEBUI_WS = 'ws://127.0.0.1:8787/ws';
const VIEW_TYPE = 'pi-assistant.chatView';

type WebuiState = 'stopped' | 'starting' | 'running';

// ---------------------------------------------------------------------------
// Process manager
// ---------------------------------------------------------------------------
class PiAssistant implements vscode.Disposable {
  private proc: cp.ChildProcess | undefined;
  private _state: WebuiState = 'stopped';

  private readonly _onStateChange = new vscode.EventEmitter<WebuiState>();
  readonly onStateChange = this._onStateChange.event;

  getState(): WebuiState {
    return this._state;
  }

  async start(): Promise<void> {
    if (this._state !== 'stopped') return;

    if (await this.probe()) {
      this.setState('running');
      return;
    }

    this.setState('starting');

    this.proc = cp.spawn('pi-webui', [], {
      stdio: 'pipe',
      env: { ...process.env },
      shell: true,
    });

    this.proc.on('error', (err) => {
      vscode.window.showErrorMessage(`PI Assistant: failed to start pi-webui — ${err.message}`);
      this.proc = undefined;
      this.setState('stopped');
    });

    this.proc.on('exit', () => {
      this.proc = undefined;
      this.setState('stopped');
    });

    const ready = await this.waitReady();
    if (ready) {
      this.setState('running');
    } else {
      vscode.window.showWarningMessage(
        'PI Assistant: pi-webui did not become ready — is it installed? Run: npm install -g @khimaros/pi-webui',
      );
      this.setState('stopped');
    }
  }

  stop(): void {
    this.proc?.kill();
    this.proc = undefined;
    this.setState('stopped');
  }

  dispose(): void {
    this.stop();
    this._onStateChange.dispose();
  }

  private setState(s: WebuiState): void {
    this._state = s;
    this._onStateChange.fire(s);
  }

  private probe(): Promise<boolean> {
    return new Promise((resolve) => {
      const req = http.get(WEBUI_URL, (res) => {
        res.destroy();
        resolve(true);
      });
      req.on('error', () => resolve(false));
      req.setTimeout(500, () => {
        req.destroy();
        resolve(false);
      });
    });
  }

  private async waitReady(attempts = 30, delayMs = 300): Promise<boolean> {
    for (let i = 0; i < attempts; i++) {
      if (await this.probe()) return true;
      await new Promise((r) => setTimeout(r, delayMs));
    }
    return false;
  }
}

// ---------------------------------------------------------------------------
// Sidebar panel
// ---------------------------------------------------------------------------
class PiWebviewProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;
  private autoOpened = false;

  constructor(private readonly assistant: PiAssistant) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = buildHtml(getNonce());

    // Send initial state once the webview is ready to receive messages
    // (small delay to let the webview JS initialise)
    setTimeout(() => this.sendState(this.assistant.getState()), 100);

    this.assistant.onStateChange((state) => {
      this.sendState(state);
      if (state === 'running' && !this.autoOpened) {
        this.autoOpened = true;
        openChat();
      }
    });

    webviewView.webview.onDidReceiveMessage((msg: { command: string }) => {
      switch (msg.command) {
        case 'openChat':
          openChat();
          break;
        case 'start':
          this.assistant
            .start()
            .catch((err: Error) =>
              vscode.window.showErrorMessage(`PI Assistant: ${err.message}`),
            );
          break;
        case 'stop':
          this.assistant.stop();
          break;
      }
    });
  }

  private sendState(state: WebuiState): void {
    this.view?.webview.postMessage({ type: 'stateChange', state });
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function openChat(): void {
  vscode.commands.executeCommand('simpleBrowser.show', WEBUI_URL);
}

function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from({ length: 32 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

// ---------------------------------------------------------------------------
// Webview HTML — built once; state updates arrive via postMessage
// ---------------------------------------------------------------------------
function buildHtml(nonce: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; connect-src ${WEBUI_WS};" />
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      background: transparent;
      overflow-x: hidden;
    }

    /* ---- Status bar ---- */
    .status-bar {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 6px 10px;
      border-bottom: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.2));
      position: sticky;
      top: 0;
      background: var(--vscode-sideBar-background, var(--vscode-editor-background));
      z-index: 10;
    }
    .dot {
      width: 7px; height: 7px;
      border-radius: 50%;
      flex-shrink: 0;
      transition: background 0.3s;
    }
    .dot.running  { background: #73c991; }
    .dot.starting { background: #e9c46a; animation: blink 1.2s ease-in-out infinite; }
    .dot.stopped  { background: #f48771; }
    @keyframes blink { 0%,100% { opacity:1; } 50% { opacity:.35; } }

    .status-label {
      flex: 1;
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .status-actions { display: flex; gap: 4px; flex-shrink: 0; }

    .btn {
      padding: 2px 8px;
      font-size: 11px;
      border: none;
      border-radius: 2px;
      cursor: pointer;
      white-space: nowrap;
    }
    .btn-primary {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
    }
    .btn-primary:hover { background: var(--vscode-button-hoverBackground); }
    .btn-primary:disabled { opacity: .5; cursor: default; }
    .btn-ghost {
      background: transparent;
      color: var(--vscode-descriptionForeground);
      border: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.3));
    }
    .btn-ghost:hover {
      background: var(--vscode-toolbar-hoverBackground);
      color: var(--vscode-foreground);
    }

    /* ---- Current session card ---- */
    .current-card {
      margin: 8px;
      padding: 8px 10px;
      border-radius: 3px;
      background: var(--vscode-editor-inactiveSelectionBackground, rgba(128,128,128,0.08));
      border: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.2));
      cursor: pointer;
    }
    .current-card:hover { border-color: var(--vscode-focusBorder, #007fd4); }
    .current-card .name {
      font-size: 12px;
      font-weight: 500;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      display: flex;
      align-items: center;
      gap: 5px;
    }
    .current-card .meta {
      margin-top: 4px;
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }
    .stream-dot {
      width: 6px; height: 6px;
      border-radius: 50%;
      background: #73c991;
      animation: blink 0.9s ease-in-out infinite;
      flex-shrink: 0;
    }

    /* ---- Section headers ---- */
    .section-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 5px 10px 3px;
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--vscode-sideBarSectionHeader-foreground, var(--vscode-descriptionForeground));
      background: var(--vscode-sideBarSectionHeader-background, transparent);
      user-select: none;
    }
    .section-header .icon-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 18px; height: 18px;
      background: transparent;
      border: none;
      cursor: pointer;
      border-radius: 3px;
      font-size: 14px;
      line-height: 1;
      color: var(--vscode-descriptionForeground);
    }
    .section-header .icon-btn:hover {
      background: var(--vscode-toolbar-hoverBackground);
      color: var(--vscode-foreground);
    }

    /* ---- Session list items ---- */
    .session-item {
      display: flex;
      flex-direction: column;
      gap: 2px;
      padding: 5px 10px;
      cursor: pointer;
      border-left: 2px solid transparent;
    }
    .session-item:hover { background: var(--vscode-list-hoverBackground); }
    .session-item.active {
      border-left-color: var(--vscode-focusBorder, #007fd4);
      background: var(--vscode-list-activeSelectionBackground);
      color: var(--vscode-list-activeSelectionForeground);
    }
    .session-item .name {
      font-size: 12px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .session-item .meta {
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .session-item.active .meta { color: inherit; opacity: .8; }

    /* ---- Badge ---- */
    .badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 0 5px;
      min-width: 18px;
      height: 16px;
      border-radius: 8px;
      font-size: 10px;
      background: var(--vscode-badge-background);
      color: var(--vscode-badge-foreground);
      flex-shrink: 0;
    }

    /* ---- Project groups (Other Projects) ---- */
    .group-header {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 4px 10px 4px 12px;
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      cursor: pointer;
      user-select: none;
    }
    .group-header:hover { background: var(--vscode-list-hoverBackground); }
    .group-chevron {
      font-size: 9px;
      transition: transform 0.15s;
      flex-shrink: 0;
    }
    .group-header.collapsed .group-chevron { transform: rotate(-90deg); }
    .group-content { }
    .group-content.collapsed { display: none; }

    /* ---- Empty / offline states ---- */
    .empty {
      padding: 10px 12px;
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      font-style: italic;
    }
    .offline {
      padding: 16px 12px;
      text-align: center;
      font-size: 12px;
      color: var(--vscode-descriptionForeground);
    }
    .offline p { margin-bottom: 8px; }
    code {
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 11px;
      background: var(--vscode-textCodeBlock-background, rgba(128,128,128,0.15));
      padding: 1px 4px;
      border-radius: 2px;
    }
  </style>
</head>
<body>

  <!-- Status bar -->
  <div class="status-bar">
    <div class="dot stopped" id="dot"></div>
    <span class="status-label" id="status-label">pi-webui: Stopped</span>
    <div class="status-actions" id="status-actions">
      <button class="btn btn-primary" onclick="send('start')">Start</button>
    </div>
  </div>

  <!-- Current session card (shown when connected) -->
  <div id="current-session-area"></div>

  <!-- This project sessions -->
  <div id="this-project-section" style="display:none">
    <div class="section-header">
      <span>This Project</span>
      <button class="icon-btn" title="New session" onclick="newSession()">+</button>
    </div>
    <div id="this-project-list"></div>
  </div>

  <!-- Other projects sessions -->
  <div id="other-projects-section" style="display:none">
    <div class="section-header">
      <span>Other Projects</span>
    </div>
    <div id="other-projects-list"></div>
  </div>

  <!-- Offline / not connected hint -->
  <div class="offline" id="offline-hint" style="display:none">
    <p>Not connected to pi-webui.</p>
    <p>Start it with: <code>pi-webui</code></p>
  </div>

<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();

  // ── State ──────────────────────────────────────────────────────────────────
  let webuiState = 'stopped';
  let ws = null;
  let wsConnected = false;
  let reconnectTimer = null;
  let sessionState = null;   // session_state payload from pi-webui
  let sessions = { currentProject: [], allProjects: [] };

  // ── Extension ↔ Webview messaging ─────────────────────────────────────────
  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (msg.type !== 'stateChange') return;
    webuiState = msg.state;
    updateStatusBar();
    if (msg.state === 'running') {
      scheduleConnect(0);
    } else if (msg.state === 'stopped') {
      teardownWs();
    }
  });

  function send(command) { vscode.postMessage({ command }); }

  // ── WebSocket ──────────────────────────────────────────────────────────────
  function scheduleConnect(delay) {
    if (reconnectTimer) return;
    reconnectTimer = setTimeout(() => { reconnectTimer = null; connectWs(); }, delay);
  }

  function connectWs() {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
    ws = new WebSocket('${WEBUI_WS}');

    ws.onopen = () => {
      wsConnected = true;
      ws.send(JSON.stringify({ type: 'ready', payload: { lastSeq: 0, sessionFile: null } }));
      updateStatusBar();
    };

    ws.onmessage = (ev) => {
      try { handleWsMsg(JSON.parse(ev.data)); } catch {}
    };

    ws.onclose = () => {
      ws = null;
      wsConnected = false;
      sessionState = null;
      sessions = { currentProject: [], allProjects: [] };
      render();
      if (webuiState === 'running') scheduleConnect(2000);
    };

    ws.onerror = () => {};
  }

  function teardownWs() {
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    if (ws) { ws.close(); ws = null; }
    wsConnected = false;
    sessionState = null;
    sessions = { currentProject: [], allProjects: [] };
    render();
  }

  function handleWsMsg(msg) {
    switch (msg.type) {
      case 'session_state':
        sessionState = msg.payload;
        renderCurrentSession();
        break;
      case 'sessions':
        sessions = msg.payload;
        renderSessionLists();
        break;
      case 'session_reset':
        sessionState = null;
        sessions = { currentProject: [], allProjects: [] };
        renderCurrentSession();
        renderSessionLists();
        break;
    }
  }

  function switchSession(path) {
    if (!wsOpen()) return;
    ws.send(JSON.stringify({ type: 'switch_session', payload: { sessionPath: path } }));
    send('openChat');
  }

  function newSession() {
    if (!wsOpen()) return;
    ws.send(JSON.stringify({ type: 'new_session' }));
    send('openChat');
  }

  function wsOpen() { return ws && ws.readyState === WebSocket.OPEN; }

  // ── Rendering ──────────────────────────────────────────────────────────────
  function render() {
    updateStatusBar();
    renderCurrentSession();
    renderSessionLists();
  }

  function updateStatusBar() {
    const dot = document.getElementById('dot');
    const label = document.getElementById('status-label');
    const actions = document.getElementById('status-actions');
    dot.className = 'dot ' + webuiState;
    const connected = wsConnected ? '' : webuiState === 'running' ? ' (connecting…)' : '';
    label.textContent = 'pi-webui: ' +
      (webuiState === 'running' ? 'Running' : webuiState === 'starting' ? 'Starting\u2026' : 'Stopped') + connected;
    if (webuiState === 'running') {
      actions.innerHTML =
        '<button class="btn btn-primary" onclick="send(\'openChat\')">Open Chat</button>' +
        '<button class="btn btn-ghost" title="Stop server" onclick="send(\'stop\')">\u25A0</button>';
    } else if (webuiState === 'starting') {
      actions.innerHTML = '<button class="btn btn-primary" disabled>Starting\u2026</button>';
    } else {
      actions.innerHTML = '<button class="btn btn-primary" onclick="send(\'start\')">Start</button>';
    }
  }

  function renderCurrentSession() {
    const area = document.getElementById('current-session-area');
    const hint = document.getElementById('offline-hint');
    if (!sessionState || !wsConnected) {
      area.innerHTML = '';
      hint.style.display = (webuiState === 'running' && !wsConnected) ? 'block' : 'none';
      return;
    }
    hint.style.display = 'none';
    const s = sessionState;
    const streamDot = s.isStreaming ? '<span class="stream-dot"></span>' : '';
    const modelText = s.model ? esc(s.model.name || s.model.id) : '';
    const cwdText = esc(shortPath(s.cwd));
    area.innerHTML =
      '<div class="current-card" onclick="send(\'openChat\')" title="Open chat">' +
        '<div class="name">' + streamDot + esc(s.sessionName || 'Unnamed session') + '</div>' +
        '<div class="meta">' +
          '<span title="' + esc(s.cwd) + '">' + cwdText + '</span>' +
          (modelText ? '<span>' + modelText + '</span>' : '') +
          '<span class="badge">' + s.messageCount + ' msg</span>' +
        '</div>' +
      '</div>';
  }

  function renderSessionLists() {
    const thisSection = document.getElementById('this-project-section');
    const otherSection = document.getElementById('other-projects-section');
    const thisEl = document.getElementById('this-project-list');
    const otherEl = document.getElementById('other-projects-list');
    const activeFile = sessionState ? sessionState.sessionFile : null;
    const currentCwd = sessionState ? sessionState.cwd : null;

    // This project
    const thisSessions = sessions.currentProject || [];
    thisSection.style.display = thisSessions.length > 0 ? 'block' : 'none';
    thisEl.innerHTML = renderItems(thisSessions, activeFile);

    // Other projects — all sessions not in current cwd
    const otherAll = (sessions.allProjects || []).filter(s => s.cwd !== currentCwd);
    if (otherAll.length === 0) {
      otherSection.style.display = 'none';
      otherEl.innerHTML = '';
    } else {
      otherSection.style.display = 'block';
      // Group by cwd
      const groups = {};
      for (const s of otherAll) {
        const k = s.cwd || '(unknown)';
        (groups[k] = groups[k] || []).push(s);
      }
      otherEl.innerHTML = Object.entries(groups).map(([cwd, items]) => {
        return '<div class="group-header" onclick="toggleGroup(this)">' +
            '<span class="group-chevron">\u25BC</span>' +
            '<span title="' + esc(cwd) + '">' + esc(shortPath(cwd)) + '</span>' +
          '</div>' +
          '<div class="group-content">' + renderItems(items, activeFile) + '</div>';
      }).join('');
    }
  }

  function renderItems(list, activeFile) {
    if (!list || list.length === 0) return '<div class="empty">No sessions</div>';
    return [...list]
      .sort((a, b) => new Date(b.modified).getTime() - new Date(a.modified).getTime())
      .map(s => {
        const active = s.path === activeFile;
        return '<div class="session-item' + (active ? ' active' : '') + '" data-path="' + esc(s.path) + '">' +
          '<div class="name">' + esc(label(s)) + '</div>' +
          '<div class="meta"><span>' + relTime(s.modified) + '</span><span class="badge">' + s.messageCount + '</span></div>' +
        '</div>';
      })
      .join('');
  }

  // ── Event delegation for session clicks ───────────────────────────────────
  document.addEventListener('click', (e) => {
    const item = e.target.closest('.session-item');
    if (item && item.dataset.path) switchSession(item.dataset.path);
  });

  function toggleGroup(header) {
    header.classList.toggle('collapsed');
    const content = header.nextElementSibling;
    if (content) content.classList.toggle('collapsed');
  }

  // ── Utilities ──────────────────────────────────────────────────────────────
  function label(s) {
    if (s.name) return s.name;
    if (s.firstMessage) return s.firstMessage.slice(0, 60);
    return 'Session ' + s.id.slice(0, 8);
  }

  function shortPath(p) {
    if (!p) return '';
    const parts = p.replace(/\\\\/g, '/').split('/').filter(Boolean);
    if (parts.length <= 2) return parts.join('/');
    return '\u2026/' + parts.slice(-2).join('/');
  }

  function relTime(iso) {
    if (!iso) return '';
    const d = Date.now() - new Date(iso).getTime();
    const m = Math.floor(d / 60000);
    const h = Math.floor(d / 3600000);
    const dy = Math.floor(d / 86400000);
    if (m < 1) return 'just now';
    if (m < 60) return m + 'm ago';
    if (h < 24) return h + 'h ago';
    if (dy < 30) return dy + 'd ago';
    return new Date(iso).toLocaleDateString();
  }

  function esc(s) {
    if (!s) return '';
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // ── Init ───────────────────────────────────────────────────────────────────
  render();
</script>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Extension entry points
// ---------------------------------------------------------------------------
export function activate(context: vscode.ExtensionContext): void {
  const assistant = new PiAssistant();
  context.subscriptions.push(assistant);

  const provider = new PiWebviewProvider(assistant);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(VIEW_TYPE, provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  );

  assistant.start().catch(() => {
    /* surfaced via showErrorMessage inside start() */
  });
}

export function deactivate(): void {}
