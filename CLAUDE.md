# withy-desktop

Withy의 Electron 셸. macOS(arm64 + x64) · Windows(x64).
사용자용 안내(내려받기, 서명, 릴리스 절차)는 `README.md` 에 있습니다 — 여기는 작업 규칙만.

## 가장 먼저 알아야 할 것

**이 레포는 UI를 만들지 않습니다.** 창 안에 뜨는 건 `https://mohe.today/withy/*` 에 이미
배포된 SPA입니다 (모바일 WebView와 동일). 화면 소스는 **다른 레포**(`tossa`)의 `web/` 에 있습니다.

| 무엇을 고치나 | 어디서 | 배포 |
|---|---|---|
| 화면, 기능, i18n, 디자인 | `tossa/web` | tossa 쪽 배포 파이프라인 (`/deploy-web`) |
| 창, 메뉴, 단축키, 알림, 딥링크, 패키징 | 여기 | `v*` 태그 → GitHub Release |

즉 **UI 버그를 여기서 고치려 하지 마세요.** 반대로 이 레포를 고쳤다고 웹을 배포할 필요도 없습니다.

번들 방식으로 바꾸고 싶어지면 `src/config.js` 상단 주석을 먼저 읽으세요 — `file://` origin은
`null` 이라 서버의 `allowCredentials(true)` CORS 설정으로는 절대 허용할 수 없습니다. 로컬 번들로
가려면 main 프로세스 API 프록시가 함께 와야 합니다.

## 계약: preload ↔ web (레포 경계를 가로지름)

`src/preload.js` 가 노출하는 `window.withyDesktop` 이 유일한 접점이고,
`tossa/web/src/lib/desktop.ts` 가 그걸 타입과 함께 감쌉니다. **두 레포에 나뉘어 있어서 컴파일러가
불일치를 못 잡습니다** — 웹은 브리지가 없으면 전부 no-op 하도록 설계돼 있어 에러 없이 조용히
죽습니다. 한쪽을 바꾸면 반드시 반대쪽도 같이 바꾸고, 두 배포를 같이 내보내세요.

메시지 방향:

| 방향 | 채널 | 쓰임 |
|---|---|---|
| renderer → main | `withy:ready` | 라우터 살아났다 → 큐에 있던 딥링크 재생 |
| main → renderer | `withy:navigate` | 메뉴/딥링크/알림 클릭 → 경로 이동 |
| main → renderer | `withy:command` | `quick-add`, `command-palette`, `toggle-sidebar`, `update-ready` |
| renderer → main | `withy:notify` / `withy:badge` / `withy:open-external` / `withy:open-chat-window` | 시스템 연동 |

새 커맨드를 추가하면 **세 곳**을 같이 고칩니다: `menu.js`(발신) → `tossa/web/src/lib/desktop.ts` 의
`DesktopCommand` 타입 → `tossa/web/src/components/DesktopBridge.tsx` 의 switch(수신).

**하위 호환에 주의**: 사용자가 옛 설치본을 계속 쓰므로, 웹 쪽에서 새 커맨드를 기대하는 코드는
브리지가 그 커맨드를 안 보내도 멀쩡해야 합니다.

## 규칙

- **동작하지 않는 메뉴 항목을 두지 않습니다.** `menu.js` 는 단축키 레지스트리이기도 해서, 항목이
  있으면 사용자는 동작한다고 읽습니다. 기간 이동(⌘[ / ⌘] / ⌘T)이 빠져 있는 건 캘린더·가계부가
  현재 달을 URL이 아닌 state로 들고 있어서입니다 — `tossa/web` 을 먼저 고쳐야 넣을 수 있습니다.
- **`webPreferences` 완화 금지.** `contextIsolation: true`, `nodeIntegration: false`,
  `sandbox: true` 가 기본값이고, 원격 페이지를 띄우는 셸이라 특히 그렇습니다.
- **네비게이션 화이트리스트**(`config.js: ALLOWED_HOSTS`)를 넓히지 마세요. 목록 밖 URL은
  시스템 브라우저로 나갑니다 — 주소창 없는 창에 외부 사이트를 가두면 피싱 표면이 됩니다.
- **구글 로그인은 시스템 브라우저 + 루프백으로 갑니다**(`main.js: beginExternalAuth`). Electron은
  패스키 챌린지를 수행할 수 없어서 — WebAuthn 플랫폼 인증기는 브라우저 전용 entitlement가
  필요합니다 — 앱 내 팝업은 "complete sign-in using your passkey"에서 멈춥니다. 그래서 RFC 8252
  방식으로 진짜 브라우저에 넘기고 `127.0.0.1` 임시 포트로 ID 토큰을 돌려받습니다. 커스텀 스킴이
  아니라 루프백인 이유: 포트는 이 프로세스가 점유하므로 다른 앱이 가로챌 수 없습니다.
  **state 논스 검증을 빼지 마세요** — 리스너가 열려 있는 동안 아무 페이지나 토큰을 던지는 걸
  막는 유일한 장치입니다. 웹 쪽 짝은 `Login.tsx`의 `?desktopAuth=<port>&state=` 분기입니다.
- **애플 로그인 팝업은 앱 안에서 열립니다**(`config.js: OAUTH_POPUP_HOSTS`). Google
  Identity Services와 Apple의 appleid.js는 `window.open` 으로 동의 화면을 띄우고 결과를
  `window.opener` 로 되돌려받습니다. 1.0.1은 이걸 시스템 브라우저로 내보내서 **로그인은
  성공하는데 앱이 결과를 못 받는** 상태였습니다. 이 목록도 좁게 유지하세요 — 팝업은 주소창이
  없어서 넓히면 그대로 피싱 표면이 됩니다.
- **macOS는 Developer ID 서명 + Apple 공증이 둘 다 있어야 배포됩니다.** 1.0.0은 ad-hoc 서명만
  돼 있었고, 그건 Apple Silicon의 실행 요건만 만족시킬 뿐 Gatekeeper 격리는 그대로라 받는 사람
  Mac에서 "손상되었으므로 열 수 없습니다"로 아예 안 열렸습니다. CI는 서명 시크릿이 없으면
  **빌드를 실패시킵니다** — 설치 안 되는 설치본을 조용히 릴리스하는 것보다 낫습니다.
  `mac.identity` 에 `Developer ID Application:` 접두사를 붙이면 electron-builder가 거부합니다.
  `disable-library-validation` 엔타이틀먼트도 그대로 두세요 (hardened runtime 조합에 필요).
- **아이콘은 `scripts/make-icons.py` 로만 만듭니다.** 손으로 만든 PNG를 넣지 마세요. macOS는
  824/1024 안전영역이 필요하고(안 지키면 Dock에서 혼자 커 보임) Windows는 마스크가 없어 풀블리드
  라서, 두 파일이 서로 다릅니다. 마크는 iOS 아이콘과 같은 비율(플레이트 폭의 68.9%)로 놓입니다.
- 새 창을 열 땐 `windowState.restore/track` 을 붙입니다. 디스플레이 변경 시 화면 밖으로 사라지는
  경우를 이미 방어해 뒀습니다.
- 릴리스 URL은 `config.js: RELEASES_URL` 한 곳에만 둡니다. `electron-builder.yml` 의
  `publish.owner/repo` 와 같은 곳을 가리켜야 합니다.

## 검증

GUI 앱이라 테스트가 없습니다. 대신 최소한 이것만은 하고 넘어갑니다.

```bash
for f in src/*.js; do node --check "$f"; done   # 문법
npm start                                        # 실제로 뜨는지, 로그인 화면이 나오는지
npx electron-builder --mac --arm64 --dir --publish never
codesign --verify --deep --strict release/mac-arm64/Withy.app   # "valid on disk" 여야 함
spctl -a -vvv -t install release/mac-arm64/Withy.app            # "accepted / Notarized Developer ID"
xcrun stapler validate release/mac-arm64/Withy.app              # 공증 티켓이 붙었는지
./release/mac-arm64/Withy.app/Contents/MacOS/Withy               # 패키징본이 실제로 뜨는지
```

`codesign --verify` 만으로는 부족합니다 — ad-hoc 서명도 그건 통과합니다. **배포 가능 여부를
가르는 건 `spctl` 이 `Notarized Developer ID` 를 뱉는지**입니다.

`codesign --verify` 가 실패하면 배포해도 사용자 기기에서 안 열립니다. **빌드가 통과했다는 것과
앱이 열린다는 것은 별개입니다** — 이 셸에서 실제로 한 번 났던 문제입니다.

브리지까지 확인하려면 창의 webContents에서 `typeof window.withyDesktop` 이 `'object'` 인지,
`window.dispatchEvent(new CustomEvent('withy:open-palette'))` 후 `[role="dialog"]` 이 뜨는지
보면 됩니다 (후자는 web 쪽이 배포돼 있어야 함).
