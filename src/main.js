'use strict';

const {
  app, BrowserWindow, ipcMain, shell, Notification,
  globalShortcut, nativeImage, dialog,
} = require('electron');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const https = require('node:https');

const {
  APP_URL, PROTOCOL, RELEASES_URL,
  GOOGLE_DESKTOP_CLIENT_ID, GOOGLE_AUTH_ENDPOINT, GOOGLE_TOKEN_ENDPOINT,
  isInternalUrl, isOAuthPopupUrl, deepLinkToPath,
} = require('./config');
const windowState = require('./windowState');
const { buildMenu } = require('./menu');

const isMac = process.platform === 'darwin';
const PRELOAD = path.join(__dirname, 'preload.js');
const OFFLINE_PAGE = path.join(__dirname, 'offline.html');

/** @type {BrowserWindow | null} */
let mainWindow = null;
/** @type {BrowserWindow | null} */
let chatWindow = null;

// Deep link that arrived before the window existed (cold start from a
// withy:// URL). Replayed once the renderer signals it's ready.
let pendingDeepLink = null;
let rendererReady = false;

// ── windows ────────────────────────────────────────────────────────────────

function createMainWindow() {
  const bounds = windowState.restore('main', {
    width: 1240,
    height: 800,
    minWidth: 960,
    minHeight: 620,
  });

  mainWindow = new BrowserWindow({
    ...bounds,
    show: false,
    backgroundColor: '#F4F6F8',
    title: 'Withy',
    // Native chrome on both platforms. A custom title bar would need the SPA
    // to reserve space for the traffic lights, and the SPA is also served to
    // plain browsers where that space would be dead padding.
    titleBarStyle: 'default',
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
    },
  });

  if (bounds.__maximized) mainWindow.maximize();
  windowState.track('main', mainWindow);
  wireWindow(mainWindow);

  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('closed', () => { mainWindow = null; rendererReady = false; });

  load(mainWindow, APP_URL);
  return mainWindow;
}

/**
 * Chat in its own window (⌘⇧C). Same session, so it shares the login — it's
 * just a second view onto the same origin.
 */
function openChatWindow() {
  if (chatWindow && !chatWindow.isDestroyed()) {
    chatWindow.show();
    chatWindow.focus();
    return chatWindow;
  }
  const bounds = windowState.restore('chat', {
    width: 460, height: 760, minWidth: 380, minHeight: 480,
  });
  chatWindow = new BrowserWindow({
    ...bounds,
    show: false,
    backgroundColor: '#F4F6F8',
    title: 'Withy — 채팅',
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  windowState.track('chat', chatWindow);
  wireWindow(chatWindow);
  chatWindow.once('ready-to-show', () => chatWindow.show());
  chatWindow.on('closed', () => { chatWindow = null; });
  load(chatWindow, urlForPath('/chat'));
  return chatWindow;
}

function urlForPath(routePath) {
  try {
    const base = new URL(APP_URL);
    const clean = routePath.startsWith('/') ? routePath : `/${routePath}`;
    // The SPA is served under /withy (vite base + Router basename).
    return new URL(`/withy${clean}`, base.origin).toString();
  } catch {
    return APP_URL;
  }
}

/** Navigation policy + failure handling shared by every window we own. */
function wireWindow(win) {
  win.webContents.setWindowOpenHandler(({ url }) => {
    // Sign-in popups must stay in-process. Google Identity Services and
    // Apple's appleid.js both `window.open` their consent screen and read the
    // result back through `window.opener`; sending that to the system browser
    // means the user signs in successfully somewhere the app can never hear
    // from — the "다른 브라우저에 뜨고 로그인해도 반응 없음" failure. Allowing
    // it returns a real child window with the opener relationship intact.
    if (isOAuthPopupUrl(url)) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 520,
          height: 700,
          minimizable: false,
          // No preload — our bridge has no business inside Google's or
          // Apple's page, and this window isn't ours to extend.
          webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
        },
      };
    }
    if (isInternalUrl(url)) {
      // Internal links that ask for a new window (invite share, admin detail)
      // stay inside the app — just navigate the window that asked.
      win.loadURL(url);
    } else {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  // Full page navigations to a third-party host (App Store, legal pages hosted
  // elsewhere) go to the system browser. Without this an accidental link could
  // strand the user on a page with no address bar. OAuth hosts are exempt —
  // a consent flow redirects between google/apple URLs several times before
  // handing the result back to the opener.
  win.webContents.on('will-navigate', (event, url) => {
    if (isInternalUrl(url) || isOAuthPopupUrl(url)) return;
    event.preventDefault();
    void shell.openExternal(url);
  });

  // Offline / server down → our own retry page instead of Chromium's
  // "ERR_INTERNET_DISCONNECTED" interstitial.
  win.webContents.on('did-fail-load', (_e, errorCode, errorDesc, validatedURL, isMainFrame) => {
    if (!isMainFrame) return;
    // -3 is ERR_ABORTED, fired for ordinary navigation races.
    if (errorCode === -3) return;
    void win.loadFile(OFFLINE_PAGE, { query: { code: String(errorCode), desc: errorDesc || '', url: validatedURL || '' } });
  });

  win.webContents.on('render-process-gone', (_e, details) => {
    if (details.reason === 'clean-exit') return;
    void win.loadFile(OFFLINE_PAGE, { query: { code: 'crash', desc: details.reason } });
  });
}

function load(win, url) {
  win.loadURL(url).catch(() => {
    void win.loadFile(OFFLINE_PAGE, { query: { code: 'load', desc: '', url } });
  });
}

// ── renderer messaging ─────────────────────────────────────────────────────

function focusMain() {
  if (!mainWindow || mainWindow.isDestroyed()) return createMainWindow();
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  return mainWindow;
}

/** Ask the SPA to route somewhere. Falls back to a hard load if it can't. */
function sendNavigate(routePath) {
  const win = focusMain();
  if (!win) return;
  if (rendererReady) {
    win.webContents.send('withy:navigate', routePath);
  } else {
    pendingDeepLink = routePath;
    load(win, urlForPath(routePath));
  }
}

/** Menu / shortcut commands the SPA acts on (quick add, palette, …). */
function sendCommand(command, payload) {
  const win = focusMain();
  if (!win) return;
  win.webContents.send('withy:command', { command, payload: payload ?? null });
}

function handleDeepLink(rawUrl) {
  const routePath = deepLinkToPath(rawUrl);
  if (!routePath) return;
  if (rendererReady) sendNavigate(routePath);
  else pendingDeepLink = routePath;
}

// ── app lifecycle ──────────────────────────────────────────────────────────

// One instance only: a second launch (or a deep-link click) focuses the
// running app rather than spawning a duplicate that fights over the session.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    // Windows/Linux deliver the deep link as an argv entry.
    const link = argv.find(a => typeof a === 'string' && a.startsWith(`${PROTOCOL}://`));
    if (link) handleDeepLink(link);
    focusMain();
  });

  // macOS delivers it as an event, before *or* after `ready`.
  app.on('open-url', (event, url) => {
    event.preventDefault();
    handleDeepLink(url);
  });

  app.whenReady().then(() => {
    registerProtocol();
    createMainWindow();
    buildMenu({ sendNavigate, sendCommand, openChatWindow, checkForUpdates });
    registerGlobalShortcuts();
    initAutoUpdate();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
      else focusMain();
    });
  });

  app.on('window-all-closed', () => {
    // macOS convention: the app stays alive in the dock. Elsewhere, closing
    // the last window quits.
    if (!isMac) app.quit();
  });

  app.on('will-quit', () => globalShortcut.unregisterAll());
}

function registerProtocol() {
  // In dev (`electron .`) the executable is Electron itself, so the handler
  // has to be registered with the script path or macOS/Windows registers the
  // wrong binary.
  if (process.defaultApp && process.argv.length >= 2) {
    app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [path.resolve(process.argv[1])]);
  } else {
    app.setAsDefaultProtocolClient(PROTOCOL);
  }
}

function registerGlobalShortcuts() {
  // Works while the app is in the background — the "적어두고 바로 사라지는"
  // capture from the mockup.
  const ok = globalShortcut.register('CommandOrControl+Alt+Space', () => {
    focusMain();
    sendCommand('quick-add');
  });
  if (!ok) {
    // Another app already owns it. Not fatal — the in-app ⌘N still works.
    console.warn('[withy] global shortcut CommandOrControl+Alt+Space unavailable');
  }
}

// ── IPC (see preload.js for the renderer-facing surface) ───────────────────

ipcMain.on('withy:ready', event => {
  if (BrowserWindow.fromWebContents(event.sender) !== mainWindow) return;
  rendererReady = true;
  if (pendingDeepLink) {
    const p = pendingDeepLink;
    pendingDeepLink = null;
    event.sender.send('withy:navigate', p);
  }
});

ipcMain.on('withy:notify', (event, payload) => {
  if (!Notification.isSupported()) return;
  const { title, body, routePath, silent } = payload || {};
  if (!title && !body) return;
  const n = new Notification({
    title: String(title || 'Withy'),
    body: String(body || ''),
    silent: !!silent,
  });
  n.on('click', () => {
    focusMain();
    if (routePath) sendNavigate(String(routePath));
  });
  n.show();
});

ipcMain.on('withy:badge', (_event, count) => {
  const n = Number(count) || 0;
  if (isMac) {
    app.setBadgeCount(n);
    return;
  }
  // Windows taskbar overlay — a dot is enough, the number is unreadable at
  // 16px anyway.
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (n <= 0) {
    mainWindow.setOverlayIcon(null, '');
    return;
  }
  const dot = nativeImage.createFromDataURL(
    'data:image/svg+xml;base64,' + Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16">' +
      '<circle cx="8" cy="8" r="7" fill="#F04452"/></svg>'
    ).toString('base64')
  );
  mainWindow.setOverlayIcon(dot, `읽지 않음 ${n}개`);
});

ipcMain.on('withy:open-external', (_event, url) => {
  if (typeof url !== 'string') return;
  if (!/^https?:\/\//i.test(url)) return;
  void shell.openExternal(url);
});

ipcMain.on('withy:open-chat-window', () => openChatWindow());

ipcMain.handle('withy:info', () => ({
  isDesktopApp: true,
  platform: process.platform,
  arch: process.arch,
  appVersion: app.getVersion(),
  electron: process.versions.electron,
}));

// ── external (system browser) sign-in ──────────────────────────────────────
//
// Google increasingly answers sign-in with a passkey challenge, and Electron
// cannot perform one: WebAuthn's platform authenticator needs Chromium wired
// into macOS through a browser-only entitlement that a normal app doesn't get.
// In-app the user reaches "Complete sign-in using your passkey" and stops.
//
// So we do what desktop apps do (RFC 8252): hand the flow to the real browser
// and take the answer back on a loopback listener. The browser owns the
// credential ceremony — passkeys, password managers, existing sessions all
// work — and 127.0.0.1 is the recommended return channel because the port is
// held by *this* process, so no other local app can claim it (unlike a custom
// scheme, which anyone may register).
//
// The page the browser opens is our own /withy/login with `desktopAuth=<port>`;
// it runs the same Google SDK it always has and hands the resulting ID token
// back here. Nothing new is trusted server-side — the token's audience is the
// same web client id the SPA already uses.

/** @type {{ server: import('node:http').Server, timer: NodeJS.Timeout } | null} */
let authListener = null;

const AUTH_TIMEOUT_MS = 5 * 60 * 1000;

function endExternalAuth() {
  if (!authListener) return;
  clearTimeout(authListener.timer);
  try { authListener.server.close(); } catch { /* already closing */ }
  authListener = null;
}

function authDonePage(ok) {
  const title = ok ? '로그인됐어요' : '로그인하지 못했어요';
  const body = ok ? 'Withy 앱으로 돌아가세요. 이 창은 닫아도 됩니다.'
                  : '앱에서 다시 시도해 주세요. 이 창은 닫아도 됩니다.';
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8">
<title>Withy</title><style>
body{margin:0;height:100vh;display:grid;place-items:center;background:#F4F6F8;
font-family:-apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Segoe UI",system-ui,sans-serif;color:#191F28}
.c{text-align:center;max-width:22rem;padding:24px}
h1{font-size:19px;margin:0 0 8px;letter-spacing:-.02em}
p{margin:0;font-size:14px;line-height:1.6;color:#4E5968}
</style></head><body><div class="c"><h1>${title}</h1><p>${body}</p></div></body></html>`;
}

function b64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Swaps the authorization code for tokens. PKCE stands in for a client secret. */
function exchangeCode({ code, verifier, redirectUri }) {
  const body = new URLSearchParams({
    code,
    client_id: GOOGLE_DESKTOP_CLIENT_ID,
    code_verifier: verifier,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
  }).toString();

  return new Promise((resolve, reject) => {
    const req = https.request(GOOGLE_TOKEN_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
      },
    }, res => {
      let raw = '';
      res.on('data', c => { raw += c; });
      res.on('end', () => {
        try {
          const json = JSON.parse(raw);
          if (json.id_token) resolve(json.id_token);
          else reject(new Error(json.error_description || json.error || 'no id_token'));
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.end(body);
  });
}

/**
 * Google sign-in through the system browser (RFC 8252).
 *
 * Electron cannot perform a passkey ceremony — WebAuthn's platform
 * authenticator needs Chromium wired into macOS through a browser-only
 * entitlement — so an in-app popup dead-ends at "complete sign-in using your
 * passkey". Every desktop app that supports Google sign-in solves this the
 * same way: send the user to their real browser, listen on loopback for the
 * redirect, exchange the code with PKCE.
 *
 * Loopback rather than a custom scheme because the port is held by *this*
 * process — no other local app can claim it, whereas anyone may register
 * `withy://`. `state` is checked to reject a redirect we didn't start.
 */
function beginExternalAuth(provider) {
  endExternalAuth();

  const state = b64url(crypto.randomBytes(24));
  const verifier = b64url(crypto.randomBytes(32));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());

  const server = http.createServer((req, res) => {
    let code = null;
    let failure = 'no_code';
    try {
      const u = new URL(req.url || '/', 'http://127.0.0.1');
      if (u.searchParams.get('state') !== state) failure = 'state_mismatch';
      else if (u.searchParams.get('error')) failure = u.searchParams.get('error');
      else code = u.searchParams.get('code');
    } catch { /* malformed — falls through as a failure */ }

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(authDonePage(!!code));

    const redirectUri = `http://127.0.0.1:${server.address().port}`;
    endExternalAuth();

    const deliver = (idToken, error) => {
      const win = focusMain();
      if (win) win.webContents.send('withy:auth-result', { provider, idToken: idToken || null, error: error || null });
    };

    if (!code) { deliver(null, failure); return; }
    exchangeCode({ code, verifier, redirectUri })
      .then(idToken => deliver(idToken, null))
      .catch(err => deliver(null, err?.message || 'exchange_failed'));
  });

  server.on('error', () => {
    endExternalAuth();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('withy:auth-result', { provider, idToken: null, error: 'listen_failed' });
    }
  });

  // Port 0 = the OS picks a free one. Google allows any port on the loopback
  // address for installed-app clients, so nothing needs pre-registering.
  server.listen(0, '127.0.0.1', () => {
    const { port } = server.address();
    const url = new URL(GOOGLE_AUTH_ENDPOINT);
    url.searchParams.set('client_id', GOOGLE_DESKTOP_CLIENT_ID);
    url.searchParams.set('redirect_uri', `http://127.0.0.1:${port}`);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'openid email profile');
    url.searchParams.set('state', state);
    url.searchParams.set('code_challenge', challenge);
    url.searchParams.set('code_challenge_method', 'S256');
    void shell.openExternal(url.toString());
  });

  const timer = setTimeout(() => {
    endExternalAuth();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('withy:auth-result', { provider, idToken: null, error: 'timeout' });
    }
  }, AUTH_TIMEOUT_MS);

  authListener = { server, timer };
}

ipcMain.on('withy:begin-external-auth', (_event, provider) => {
  beginExternalAuth(provider === 'apple' ? 'apple' : 'google');
});

ipcMain.on('withy:cancel-external-auth', () => endExternalAuth());

app.on('will-quit', () => endExternalAuth());

// ── auto update ────────────────────────────────────────────────────────────

let updater = null;

function initAutoUpdate() {
  if (!app.isPackaged) return;
  try {
    const { autoUpdater } = require('electron-updater');
    updater = autoUpdater;
    updater.autoDownload = true;
    updater.autoInstallOnAppQuit = true;
    updater.on('update-downloaded', info => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      mainWindow.webContents.send('withy:command', {
        command: 'update-ready',
        payload: { version: info?.version || '' },
      });
    });
    // A private GitHub repo can't be polled without a token, and we are not
    // shipping one inside the app. Log and move on — "업데이트 확인" in the
    // menu opens the releases page, which always works.
    updater.on('error', err => console.warn('[withy] update check failed:', err?.message || err));
    // `.catch` and not `void` — checkForUpdates() rejects (not just emits
    // 'error') when app-update.yml is missing or the repo is private, and an
    // unhandled rejection is noise in every log we'd ever read.
    updater.checkForUpdates().catch(err => {
      console.warn('[withy] update check skipped:', err?.message || err);
    });
  } catch (err) {
    console.warn('[withy] updater unavailable:', err?.message || err);
  }
}

async function checkForUpdates() {
  if (!app.isPackaged || !updater) {
    void shell.openExternal(RELEASES_URL);
    return;
  }
  try {
    const result = await updater.checkForUpdates();
    const version = result?.updateInfo?.version;
    if (!version || version === app.getVersion()) {
      await dialog.showMessageBox({
        type: 'info',
        message: '최신 버전을 쓰고 있어요',
        detail: `현재 버전 ${app.getVersion()}`,
        buttons: ['확인'],
      });
    }
  } catch {
    const { response } = await dialog.showMessageBox({
      type: 'info',
      message: '업데이트를 확인하지 못했어요',
      detail: '릴리스 페이지에서 최신 버전을 내려받을 수 있어요.',
      buttons: ['릴리스 열기', '닫기'],
      defaultId: 0,
      cancelId: 1,
    });
    if (response === 0) void shell.openExternal(RELEASES_URL);
  }
}

module.exports = { sendNavigate, sendCommand };
