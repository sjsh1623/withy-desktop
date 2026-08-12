'use strict';

/**
 * Single place where "which server does the shell talk to" is decided.
 *
 * The desktop client is a *shell around the deployed SPA*, exactly like the
 * iOS/Android WebView (mobile/App.tsx loads the same URL). It does NOT bundle
 * its own copy of web/dist. Two reasons:
 *
 *   1. Same-origin. The SPA calls `/withy/api/*` relative to its own origin.
 *      Loading it from https://mohe.today means zero CORS surface — a local
 *      `file://` bundle would have origin `null`, which the server's
 *      `allowCredentials(true)` CORS config can never allowlist.
 *   2. It rides the normal `/deploy` pipeline. A web deploy is instantly live
 *      in the desktop app too; the shell only needs a new release when the
 *      *native* layer changes.
 *
 * Override with WITHY_URL when pointing at a local `npm run dev` (see
 * `npm run start:dev`).
 */

const APP_ORIGIN = 'https://mohe.today';
const APP_URL = process.env.WITHY_URL || `${APP_ORIGIN}/withy/home`;

// Hosts the shell is allowed to render in-window. Anything else (a bank's
// payment page, an external blog link, an OAuth consent screen) is handed to
// the system browser instead — see `openExternal` wiring in main.js.
const ALLOWED_HOSTS = new Set([
  'mohe.today',
  'www.mohe.today',
  'localhost',
  '127.0.0.1',
]);

/**
 * Sign-in popups that must open INSIDE the app, not in the system browser.
 *
 * The SPA signs in with JS SDKs that use `window.open` and hand the result
 * back through `window.opener` (Google Identity Services, Apple's appleid.js).
 * Routing those to the system browser — which is what the generic external-link
 * rule did — breaks the flow completely: the user signs in successfully over
 * there and the app never hears about it, because the opener relationship is
 * gone. That is the "다른 브라우저에 뜨고 로그인해도 반응이 없음" report.
 *
 * These hosts are Google's and Apple's own sign-in origins. Keeping the list
 * this narrow is the point — a popup is a window without an address bar, so
 * anything broader is a phishing surface.
 */
const OAUTH_POPUP_HOSTS = new Set([
  'accounts.google.com',
  'accounts.youtube.com',
  'appleid.apple.com',
  'idmsa.apple.com',
]);

function isOAuthPopupUrl(rawUrl) {
  try {
    return OAUTH_POPUP_HOSTS.has(new URL(rawUrl).hostname);
  } catch {
    return false;
  }
}

/** withy://join?code=... — invite deep links and OAuth returns. */
const PROTOCOL = 'withy';

/**
 * Where builds are published. Defined once: the menu's "릴리스 노트" item, the
 * "업데이트 확인" fallback, and electron-builder's `publish` block all have to
 * point at the same place, and three copies of a URL is three chances to
 * drift. (electron-builder.yml carries owner/repo separately — keep in sync.)
 */
const RELEASES_URL = 'https://github.com/sjsh1623/withy-desktop/releases';

function isInternalUrl(rawUrl) {
  try {
    const u = new URL(rawUrl);
    return ALLOWED_HOSTS.has(u.hostname);
  } catch {
    return false;
  }
}

/**
 * Maps a `withy://` deep link onto an in-app route.
 *   withy://join?code=ABC   → /join?code=ABC
 *   withy://schedule/12     → /schedule/12
 *   withy:///ledger         → /ledger
 */
function deepLinkToPath(rawUrl) {
  try {
    const u = new URL(rawUrl);
    if (u.protocol !== `${PROTOCOL}:`) return null;
    // `withy://join?code=1` parses with host='join', pathname=''.
    // `withy:///ledger`     parses with host='',     pathname='/ledger'.
    const path = `/${u.hostname}${u.pathname}`.replace(/\/{2,}/g, '/').replace(/\/$/, '') || '/home';
    return `${path}${u.search}`;
  } catch {
    return null;
  }
}

module.exports = { APP_ORIGIN, APP_URL, ALLOWED_HOSTS, OAUTH_POPUP_HOSTS, PROTOCOL, RELEASES_URL, isInternalUrl, isOAuthPopupUrl, deepLinkToPath };
