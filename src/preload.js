'use strict';

const { contextBridge, ipcRenderer } = require('electron');

/**
 * The entire surface the web app sees. Deliberately small and one-way where
 * possible: the renderer can ask for a notification or a badge, but it can't
 * reach `shell`, `fs`, or an arbitrary ipc channel.
 *
 * Mirrored on the web side by `web/src/lib/desktop.ts` — keep the two in sync.
 */

function subscribe(channel, handler) {
  if (typeof handler !== 'function') return () => {};
  const listener = (_event, payload) => {
    try { handler(payload); } catch { /* a throwing app handler must not kill the bridge */ }
  };
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('withyDesktop', {
  /** Always true — its presence is how the SPA detects the desktop shell. */
  isDesktopApp: true,

  /** Renderer → main: "the router is mounted, replay anything you queued." */
  ready() {
    ipcRenderer.send('withy:ready');
  },

  /** main → renderer: route somewhere (menu item, deep link, notification click). */
  onNavigate(handler) {
    return subscribe('withy:navigate', handler);
  },

  /** main → renderer: `{ command, payload }` — quick-add, command-palette, … */
  onCommand(handler) {
    return subscribe('withy:command', handler);
  },

  /** System notification. `routePath` is where a click should land. */
  notify(payload) {
    ipcRenderer.send('withy:notify', {
      title: payload?.title ?? 'Withy',
      body: payload?.body ?? '',
      routePath: payload?.routePath ?? null,
      silent: !!payload?.silent,
    });
  },

  /** Dock badge (macOS) / taskbar overlay dot (Windows). */
  setBadge(count) {
    ipcRenderer.send('withy:badge', Number(count) || 0);
  },

  /** Open a http(s) URL in the system browser. */
  openExternal(url) {
    ipcRenderer.send('withy:open-external', String(url || ''));
  },

  /** Pop chat out into its own window. */
  openChatWindow() {
    ipcRenderer.send('withy:open-chat-window');
  },

  /** `{ platform, arch, appVersion, electron }` */
  info() {
    return ipcRenderer.invoke('withy:info');
  },
});
