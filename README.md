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

Apple Developer ID로 서명하고 Apple 공증(notarization)을 받았습니다.
받아서 `/Applications` 에 넣고 그냥 열면 됩니다 — 터미널 명령이 필요 없습니다.

> 1.0.0은 ad-hoc 서명만 돼 있어서 Gatekeeper가 격리했고, "손상되었으므로 열 수 없습니다"로
> 설치가 안 됐습니다. 1.0.1부터 해결됐습니다.

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

macOS는 **Developer ID 서명 + Apple 공증**이 필수입니다. 둘 중 하나라도 빠지면 다른 사람의
Mac에서 열리지 않습니다 (1.0.0이 그랬습니다). CI는 시크릿이 없으면 **빌드를 실패시킵니다** —
설치되지 않는 설치본을 조용히 릴리스하는 것보다 낫기 때문입니다.

| 시크릿 | 값 |
|---|---|
| `MAC_CSC_LINK` | Developer ID Application `.p12` 를 base64로 인코딩한 문자열 |
| `MAC_CSC_KEY_PASSWORD` | 그 `.p12` 의 암호 |
| `APPLE_API_KEY_P8` | App Store Connect API 키 `.p8` 을 base64로 인코딩한 문자열 |
| `APPLE_API_KEY_ID` | 키 ID (예: `YZVPSDU29B`) |
| `APPLE_API_ISSUER` | Issuer ID (팀당 하나) |
| `WIN_CSC_LINK` / `WIN_CSC_KEY_PASSWORD` | Windows 코드 서명 인증서 — **선택**, 없으면 미서명 |

인증서는 `Developer ID Application: Andrew Studio (B7JXA8GGC8)`, 2031-08-13 만료입니다.
공증은 앱 암호 대신 **App Store Connect API 키**를 씁니다 — 2FA를 타지 않아 CI에 맞습니다.

`electron-builder.yml` 의 `mac.identity` 에는 **`Developer ID Application:` 접두사를 붙이지
마세요.** electron-builder가 거부하고, 인증서 종류는 타깃에서 알아서 고릅니다.
`entitlements.mac.plist` 의 `com.apple.security.cs.disable-library-validation` 도 그대로 두세요
(hardened runtime 조합에서 필요).

### 서명 없이 빌드하기

인증서 없는 기계에서 앱 구조만 확인하고 싶을 때:

```bash
npx electron-builder --mac --arm64 --dir -c.mac.identity=- -c.mac.notarize=false
```

이렇게 만든 앱은 **배포하면 안 됩니다** — 받는 사람 Mac에서 안 열립니다.

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
