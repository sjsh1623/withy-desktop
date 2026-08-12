# Withy Desktop

[Withy](https://mohe.today/withy/) — 커플 가계부 · 캘린더 — 의 데스크탑 클라이언트.
Electron 셸이며 macOS(Apple Silicon · Intel)와 Windows를 지원합니다.

## 내려받기

[Releases](https://github.com/sjsh1623/withy-desktop/releases) 탭에서 받습니다.

| 기기 | 파일 |
|---|---|
| Mac — Apple Silicon (M1 이상) | `Withy-<버전>-mac-arm64.dmg` |
| Mac — Intel | `Withy-<버전>-mac-x64.dmg` |
| Windows 10/11 — 설치형 | `Withy-Setup-<버전>.exe` |
| Windows — 설치 없이 실행 | `Withy-<버전>-portable.exe` |

### macOS 첫 실행

Apple 공증(notarization)을 아직 붙이지 않았습니다. 앱은 **ad-hoc 서명**되어 있어 실행 자체는
되지만, 인터넷에서 받은 파일이라 Gatekeeper가 격리 플래그를 붙여 "손상되었으므로 열 수 없습니다"가
뜹니다. `/Applications` 로 옮긴 뒤 한 번만:

```bash
xattr -dr com.apple.quarantine /Applications/Withy.app
```

제대로 없애려면 Developer ID 인증서를 CI 시크릿에 넣으면 됩니다 — 아래 **서명** 참고.

### Windows 첫 실행

코드 서명 인증서가 없어 SmartScreen이 "알 수 없는 게시자"로 막습니다.
**추가 정보 → 실행**을 누르면 됩니다.

## 이 레포에 없는 것

**화면이 없습니다.** 창 안에 뜨는 UI는 이미 배포돼 있는 SPA(`https://mohe.today/withy/*`)이고,
그 소스는 제품 레포(`tossa`)의 `web/` 에 있습니다. iOS/Android 앱도 같은 URL을 띄웁니다.

```
tossa/web        →  화면·기능·i18n          →  자체 배포 파이프라인
withy-desktop    →  창·메뉴·단축키·알림·딥링크  →  이 레포의 릴리스
```

그래서:

- **UI를 고치려면 `tossa/web` 을 고치고 그쪽을 배포합니다.** 데스크탑 새 빌드가 필요 없습니다 —
  사용자가 앱을 다시 열면 바로 반영됩니다.
- **이 레포를 고쳤을 때만** 새 태그를 밀어 설치본을 다시 만듭니다.

번들 방식(로컬에 SPA를 넣는 것)으로 바꾸고 싶다면 `src/config.js` 상단 주석을 먼저 읽으세요.

## 구조

```
src/
├── main.js         앱 수명주기, 창, IPC, 딥링크, 자동 업데이트
├── preload.js      contextBridge — window.withyDesktop (유일한 renderer 접점)
├── menu.js         네이티브 메뉴 = 단축키 레지스트리
├── config.js       어느 서버를 볼지 / 어떤 호스트를 창 안에서 열지 / 릴리스 URL
├── windowState.js  창 위치·크기 기억 (디스플레이 변경 방어 포함)
└── offline.html    서버에 못 닿을 때의 재시도 화면
```

웹 쪽 짝은 `tossa/web/src/lib/desktop.ts` + `tossa/web/src/components/DesktopBridge.tsx` 입니다.
**`preload.js` 와 `desktop.ts` 는 같은 계약을 두 레포에서 나눠 구현합니다 — 한쪽만 고치면
조용히 no-op 이 됩니다.**

## 개발

```bash
npm install
npm start                # prod SPA(mohe.today)에 붙어서 실행
npm run start:dev        # localhost:5173 (tossa/web 에서 npm run dev 를 먼저 띄울 것)
```

로컬 패키징:

```bash
npm run build:mac:arm64  # release/ 에 dmg + zip
npm run build:win        # Windows 설치본 (NSIS 생성은 Windows 러너 권장)
npm run pack             # 설치본 없이 .app/.exe 만
```

## 릴리스

```bash
# package.json 의 version 을 올린 뒤
git tag v1.0.1
git push origin v1.0.1
```

`.github/workflows/release.yml` 이 macOS(arm64 + x64) · Windows(x64)를 각각 빌드해 하나의
GitHub Release에 붙입니다. Actions 탭에서 수동 실행(`workflow_dispatch`)도 됩니다.

## 서명

기본값은 무료 경로입니다 — macOS ad-hoc, Windows 미서명.

| 시크릿 | 효과 |
|---|---|
| `MAC_IDENTITY` | 있으면 Developer ID 서명 + 공증으로 전환 (예: `Developer ID Application: Andrew Studio (TEAMID)`) |
| `MAC_CSC_LINK` / `MAC_CSC_KEY_PASSWORD` | base64 인코딩한 `.p12` 와 암호 |
| `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID` | 공증 자격증명 |
| `WIN_CSC_LINK` / `WIN_CSC_KEY_PASSWORD` | Windows 코드 서명 인증서 |

셋 다 없어도 빌드는 통과합니다. 코드 변경 없이 시크릿만 추가하면 서명 경로로 넘어갑니다.

**`electron-builder.yml` 의 `mac.identity: "-"` 는 지우지 마세요.** Apple Silicon은 서명이 아예
없는 arm64 바이너리를 실행조차 거부하는데, electron-builder는 번들을 수정하면서 상위(Electron)
서명을 깨뜨립니다. ad-hoc 서명이 바닥값입니다. 같은 이유로 `build/entitlements.mac.plist` 의
`com.apple.security.cs.disable-library-validation` 도 필요합니다 (hardened runtime + ad-hoc 조합).

## 자동 업데이트

`electron-updater`가 이 레포의 Releases를 봅니다. **레포가 private이면 토큰 없이는 조회가
실패합니다** — 그 경우 조용히 로그만 남기고, 메뉴의 "업데이트 확인…" 이 릴리스 페이지를 여는
것으로 대체됩니다. 제품 소스가 없는 셸 전용 레포이므로 **public으로 두면 자동 업데이트가 그냥
동작합니다.**

## 아직 안 된 것

- **오프라인**: 서버에 못 닿으면 재시도 화면이 뜹니다. 로컬 캐시로 읽기를 지원하려면 SPA를
  번들하고 API를 main 프로세스로 프록시해야 합니다 (`config.js` 주석 참고).
- **기간 이동 단축키**(⌘[ / ⌘] / ⌘T): 캘린더·가계부가 보고 있는 달을 URL이 아니라 컴포넌트
  state로 들고 있어 메뉴에서 조작할 수 없습니다. 동작하지 않는 메뉴 항목을 두지 않으려고 뺐습니다.
  `tossa/web` 쪽을 먼저 손봐야 합니다.
- **전역 빠른 입력**은 별도의 작은 창이 아니라 메인 창을 띄우고 `/add` 로 보냅니다.
