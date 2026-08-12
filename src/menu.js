'use strict';

const { app, Menu, shell } = require('electron');
const { RELEASES_URL } = require('./config');

const isMac = process.platform === 'darwin';

/**
 * The native application menu. Every accelerator here is also the app's
 * documented shortcut — the menu *is* the shortcut registry, so there's one
 * place to change a binding rather than a menu entry and a renderer keydown
 * handler drifting apart.
 *
 * Items either navigate (`sendNavigate`) or emit a command the SPA handles
 * (`sendCommand`); nothing in this file knows what a screen looks like.
 */
function buildMenu({ sendNavigate, sendCommand, openChatWindow, checkForUpdates }) {
  const nav = (label, routePath, accelerator) => ({
    label, accelerator, click: () => sendNavigate(routePath),
  });
  const cmd = (label, command, accelerator) => ({
    label, accelerator, click: () => sendCommand(command),
  });

  /** @type {Electron.MenuItemConstructorOptions[]} */
  const template = [];

  if (isMac) {
    template.push({
      label: app.name,
      submenu: [
        { role: 'about', label: 'Withy 정보' },
        { type: 'separator' },
        nav('설정…', '/more', 'CommandOrControl+,'),
        { label: '업데이트 확인…', click: () => void checkForUpdates() },
        { type: 'separator' },
        { role: 'services', label: '서비스' },
        { type: 'separator' },
        { role: 'hide', label: 'Withy 가리기' },
        { role: 'hideOthers', label: '다른 항목 가리기' },
        { role: 'unhide', label: '모두 보기' },
        { type: 'separator' },
        { role: 'quit', label: 'Withy 종료' },
      ],
    });
  }

  template.push({
    label: '파일',
    submenu: [
      cmd('새 지출·수입…', 'quick-add', 'CommandOrControl+N'),
      cmd('새 일정…', 'quick-add-schedule', 'CommandOrControl+Shift+N'),
      cmd('새 할 일…', 'quick-add-todo', 'CommandOrControl+Shift+T'),
      { type: 'separator' },
      nav('영수증 가져오기…', '/add/import'),
      nav('내보내기…', '/more/export'),
      { type: 'separator' },
      ...(isMac
        ? [{ role: 'close', label: '창 닫기' }]
        : [
            nav('설정', '/more', 'Control+,'),
            { label: '업데이트 확인…', click: () => void checkForUpdates() },
            { type: 'separator' },
            { role: 'quit', label: '종료' },
          ]),
    ],
  });

  template.push({
    label: '편집',
    submenu: [
      { role: 'undo', label: '실행 취소' },
      { role: 'redo', label: '다시 실행' },
      { type: 'separator' },
      { role: 'cut', label: '오려두기' },
      { role: 'copy', label: '복사' },
      { role: 'paste', label: '붙여넣기' },
      { role: 'selectAll', label: '전체 선택' },
    ],
  });

  template.push({
    label: '보기',
    submenu: [
      nav('홈', '/home', 'CommandOrControl+1'),
      nav('가계부', '/ledger', 'CommandOrControl+2'),
      nav('캘린더', '/calendar', 'CommandOrControl+3'),
      nav('분석', '/analytics', 'CommandOrControl+4'),
      { type: 'separator' },
      nav('목표', '/goal'),
      nav('할 일', '/todo'),
      nav('용돈', '/allowance'),
      nav('알림', '/notifications'),
      { type: 'separator' },
      cmd('사이드바 접기/펴기', 'toggle-sidebar', 'CommandOrControl+Alt+S'),
      { type: 'separator' },
      { role: 'reload', label: '새로고침' },
      { role: 'forceReload', label: '강제 새로고침' },
      { role: 'resetZoom', label: '실제 크기' },
      { role: 'zoomIn', label: '확대' },
      { role: 'zoomOut', label: '축소' },
      { type: 'separator' },
      { role: 'togglefullscreen', label: '전체 화면' },
      { role: 'toggleDevTools', label: '개발자 도구' },
    ],
  });

  // 기간 이동(⌘[ / ⌘] / ⌘T)은 아직 없다. 캘린더·가계부가 보고 있는 달을
  // URL이 아니라 컴포넌트 state로 들고 있어서, 메뉴에서 조작하려면 그 페이지
  // 들을 먼저 손봐야 한다. 동작하지 않는 메뉴 항목을 두느니 비워 둔다.
  template.push({
    label: '이동',
    submenu: [
      cmd('빠른 실행…', 'command-palette', 'CommandOrControl+K'),
    ],
  });

  template.push({
    label: '창',
    submenu: [
      { role: 'minimize', label: '최소화' },
      { role: 'zoom', label: '확대/축소' },
      { type: 'separator' },
      { label: '채팅을 새 창으로', accelerator: 'CommandOrControl+Shift+C', click: () => openChatWindow() },
      ...(isMac ? [{ type: 'separator' }, { role: 'front', label: '모두 앞으로 가져오기' }] : []),
    ],
  });

  template.push({
    role: 'help',
    label: '도움말',
    submenu: [
      nav('도움말', '/more/help'),
      nav('문의하기', '/more/inquiries'),
      { type: 'separator' },
      { label: '릴리스 노트', click: () => void shell.openExternal(RELEASES_URL) },
      { label: '개인정보 처리방침', click: () => void shell.openExternal('https://mohe.today/withy/legal/privacy') },
    ],
  });

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

module.exports = { buildMenu };
