'use strict';

const { app, screen } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

/**
 * Remembers window geometry across launches. Deliberately tiny (no extra dep):
 * one JSON file per window key under userData.
 *
 * The saved bounds are validated against the *current* display layout on
 * restore — otherwise unplugging the external monitor you last used strands
 * the window off-screen with no way to drag it back.
 */
function stateFile(key) {
  return path.join(app.getPath('userData'), `window-${key}.json`);
}

function read(key) {
  try {
    return JSON.parse(fs.readFileSync(stateFile(key), 'utf8'));
  } catch {
    return null;
  }
}

function visibleOnSomeDisplay(bounds) {
  return screen.getAllDisplays().some(d => {
    const a = d.workArea;
    // Require a decent overlap, not a single pixel — a window 2px onto a
    // screen is functionally lost.
    const overlapX = Math.min(bounds.x + bounds.width, a.x + a.width) - Math.max(bounds.x, a.x);
    const overlapY = Math.min(bounds.y + bounds.height, a.y + a.height) - Math.max(bounds.y, a.y);
    return overlapX > 120 && overlapY > 80;
  });
}

/** Returns BrowserWindow bounds options, falling back to `fallback` when unusable. */
function restore(key, fallback) {
  const saved = read(key);
  if (!saved || typeof saved.width !== 'number' || typeof saved.height !== 'number') return { ...fallback };
  const bounds = {
    width: Math.max(fallback.minWidth || 0, saved.width),
    height: Math.max(fallback.minHeight || 0, saved.height),
  };
  if (typeof saved.x === 'number' && typeof saved.y === 'number') {
    const candidate = { x: saved.x, y: saved.y, width: bounds.width, height: bounds.height };
    if (visibleOnSomeDisplay(candidate)) {
      bounds.x = saved.x;
      bounds.y = saved.y;
    }
  }
  return { ...fallback, ...bounds, __maximized: !!saved.maximized };
}

/** Persists geometry on move/resize/close. Debounced so dragging isn't chatty. */
function track(key, win) {
  let timer = null;

  function save() {
    if (win.isDestroyed()) return;
    // Never persist minimized/fullscreen geometry — restoring into it is
    // disorienting and the OS reports junk bounds while minimized.
    if (win.isMinimized() || win.isFullScreen()) return;
    const maximized = win.isMaximized();
    const b = maximized ? win.getNormalBounds() : win.getBounds();
    try {
      fs.writeFileSync(stateFile(key), JSON.stringify({ ...b, maximized }));
    } catch {
      // Disk full / sandboxed path — geometry memory is a nicety, not a
      // reason to crash the app.
    }
  }

  function schedule() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(save, 400);
  }

  win.on('resize', schedule);
  win.on('move', schedule);
  win.on('maximize', schedule);
  win.on('unmaximize', schedule);
  win.on('close', () => {
    if (timer) clearTimeout(timer);
    save();
  });
}

module.exports = { restore, track };
