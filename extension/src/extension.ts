import * as vscode from 'vscode';

const WEBUI_URL = 'http://127.0.0.1:8787';
const VIEW_TYPE = 'pi-assistant.chatView';

class PiWebviewProvider implements vscode.WebviewViewProvider {
  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = this.buildHtml();
  }

  private buildHtml(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta
    http-equiv="Content-Security-Policy"
    content="default-src 'none'; frame-src ${WEBUI_URL}; style-src 'unsafe-inline';"
  />
  <style>
    html, body {
      margin: 0;
      padding: 0;
      width: 100%;
      height: 100vh;
      overflow: hidden;
      background: transparent;
    }
    iframe {
      display: block;
      border: none;
      width: 100%;
      height: 100%;
    }
    #offline {
      display: none;
      padding: 16px;
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
    }
    iframe.error + #offline { display: block; }
  </style>
</head>
<body>
  <iframe
    src="${WEBUI_URL}"
    title="PI Assistant"
    sandbox="allow-scripts allow-forms allow-same-origin allow-popups"
  ></iframe>
  <div id="offline">
    <p><strong>PI webui is not running.</strong></p>
    <p>Start it with: <code>pi-webui</code></p>
  </div>
</body>
</html>`;
  }
}

export function activate(context: vscode.ExtensionContext): void {
  const provider = new PiWebviewProvider();
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(VIEW_TYPE, provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  );
}

export function deactivate(): void {}
