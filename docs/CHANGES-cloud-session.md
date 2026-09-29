# 클라우드 세션 수정내역 (움막AI 참고용)

기준: 움막AI가 push한 `b3b3646` 이후 이 브랜치(`claude/sleepy-darwin-0zm54g`)에 쌓인 변경.
검증: `npx tsc --noEmit` 오류 0개, `npm run build` 통과. **DB·실제 POS 기기·PowerShell 실행은 클라우드에서 검증하지 못했다**(아래 "검증 못 한 것" 참고).

## 1. 배포 절차 (순서 중요)

1. **DB 백업**
2. 코드 pull → `npm ci` → `npm run build`
3. **마이그레이션 실행** — `scripts/migrate-to-multitenant.ts` (작성만 했고 실행은 안 함)
   ```bash
   MONGODB_URI="..." npx tsx scripts/migrate-to-multitenant.ts           # 미리보기(기본)
   MONGODB_URI="..." npx tsx scripts/migrate-to-multitenant.ts --apply   # 반영
   ```
   - 더파티·반들한식뷔페 Company 생성, 기존 매장에 companyId 부여, `isHqAdmin:true` → `role:"owner"`, `storeAdminOf` → `role:"manager"`+`storeManagerOf`.
   - 멱등. 옛 필드(`isHqAdmin`, `storeAdminOf`)는 지우지 않는다.
3-1. **이전 계정 비밀번호 비우기** — `scripts/blank-imported-passwords.ts`(미리보기 → `--apply`). 아래 5-3 참고
   - 미리보기에서 "고객사가 없는 매장 N개" 경고가 나오면 수동 지정 필요(`companyId`는 필수).
4. 서버 재시작 (권한 체계·등록 방식이 바뀌었으므로)
5. 모든 사용자는 **재로그인** 필요(세션이 JWT라 role 변경이 즉시 반영되지 않음)

### 환경변수
| 이름 | 용도 |
|---|---|
| `MONGODB_URI` | 기존과 동일 |
| `APP_BASE_URL` | 포스 프로그램 zip에 내장되는 접속 주소. 없으면 요청 origin. 프록시 뒤라면 반드시 설정 |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | **신규, 앱 알림(웹 푸시)에 필수.** 아래 "앱 알림 설정" 참고. 없으면 앱 알림 기능이 꺼진다(화면은 조용히 건너뜀) |
| `SMS_WEBHOOK_URL` | **신규, 선택.** 문자 발송 게이트웨이 주소. 없으면 문자는 나가지 않음(앱 알림만 사용) |
| `SMS_WEBHOOK_TOKEN` | **신규, 선택.** 있으면 `Authorization: Bearer` 로 전송 |

## 2. 권한 정리 (tsc 에러 해소)

옛 `requireHqAdmin` / `requireStoreAdmin` / `session.isHqAdmin` 참조를 전부 새 체계로 교체. 잔존 참조 없음(grep 확인).

| 파일 | 변경 |
|---|---|
| `app/api/v1/owner/app-versions/route.ts` (구 `hq/app-versions`) | `requireOwner` |
| `app/api/v1/hq/customers/[id]/usage`, `hq/points/adjust`, `hq/points/grant` | `requireCompanyAdmin` |
| `app/api/v1/hq/stores/[storeId]/vendor-config` | `requireCompanyAdmin` + `assertStoreScope`(추가) |
| `app/api/v1/stores/[storeId]/pos-vendor-summary` | audit actorType을 `role` 기준으로 |
| `app/owner/app-releases/page.tsx` | `role !== "owner"` 이면 redirect |

기존 버그 1건: `app/hq/stores/StoresClient.tsx`가 `data.storeAdmin.tempPassword`를 읽었으나 API는 `storeManager`를 반환 → 수정.

## 3. `/owner` 섹션 (신설, owner 전용)

- `app/owner/layout.tsx` — 사이드바: 고객사 관리 / 운영자 배정 / 매장 가입 신청(`/hq/applications` 링크) / 고객앱 버전 관리
- `/owner` — 고객사 목록·생성·이름변경 (`api/v1/owner/companies`, `companies/[id]`)
- `/owner/admins` — 회원 전화번호로 운영자(admin) 배정·해제 (`api/v1/owner/admins`). owner·manager 계정은 변경 불가(409)
- `/owner/app-releases` — `/hq/app-releases`에서 이동. API도 `/api/v1/owner/app-versions`로 이동(공개 다운로드 API `api/v1/app-versions/*`는 그대로)
- `/owner/applications` — 5-5에서 `/hq/applications`가 이곳으로 이동

## 4. 원샷 설치 (인증코드 없는 포스기 설치)

### 서버
- `lib/models/PosProvisionToken.ts` — 매장별 1회용 설치 토큰. 원문은 저장하지 않고 sha256 해시만 저장, 24시간 TTL
- `app/api/v1/pos-agent/download/route.ts` — 재작성. `requireStoreManager` + `resolveStoreId`(`?storeId=`). 호출마다 토큰을 새로 만들어 `pos-agent-src/*` + `provision.json`을 **즉석 zip**으로 응답
- `lib/zip.ts` — 의존성 없는 zip 생성기(`archiver`는 설치·lock 갱신을 피하려고 쓰지 않음). `package.json` 변경 없음
- `POST /api/v1/pos/agent/register` — `{token, terminalName}` → 토큰을 원자적으로 소모(`findOneAndDelete`) → PosTerminal 생성·apiKey 발급. 매장의 첫 ACTIVE 단말이면 `isPrimary`. IP당 20회/10분 제한
- `GET /api/v1/pos/agent/terminals` — Bearer apiKey 인증, 자기 매장 포스기 목록
- **삭제:** `api/v1/pos/agent/pairing-code`, `api/v1/stores/[storeId]/pos-terminals/pairing-code`, `api/v1/pos/terminals/register`(옛 코드 방식), `lib/models/PosPairingCode.ts`
- `/store/terminals` — "포스기 다운로드" 버튼 + 등록 목록·대표지정·해지·상세로 단순화(코드 발급·LAN 탐색 UI 제거). 사이드바 라벨은 "포스기 다운로드"

### 에이전트 `pos-agent-src/point-terminal-agent.ps1` (617줄 → 약 480줄)
- `provision.json`의 토큰으로 `/api/v1/pos/agent/register` 자동 호출 → `terminal-config.json` 저장 → `provision.json` 삭제
- 등록 직후 `Show-TerminalList` 창으로 포스기 목록 자동 표시, 트레이 메뉴에 "포스기 목록..." 추가
- **제거:** `Read-Host` 코드 입력, `Start-DiscoveryAnnounce/Listener`, `Start-LocalHttpApi`, `Register-PeerByIp`, `$Script:Peers`, 관련 파라미터(`LocalHttpPort`, `DiscoveryUdpPort`, `DiscoveryIntervalSec`)
- **UTF-8 BOM 유지** — Windows PowerShell 5.1이 한글을 읽으려면 필요. 이 파일을 편집할 때 BOM을 잃지 말 것
- 이미 설치된 포스기는 그대로 동작(apiKey 방식 불변). 새 설치만 새 방식

### 동작상 주의
- 받은 zip 하나는 **한 번만** 등록된다. 포스기를 더 추가하려면 그 PC에서 다시 다운로드
- 토큰이 든 zip은 그 매장의 등록 권한을 가지므로 외부 전달 금지(화면에도 안내)

## 5. 비밀번호 찾기 · 변경 (신규)

배경: 일괄 이전으로 만들어진 고객 계정은 무작위 비밀번호(`lib/points.ts`)라 본인이 로그인할 수 없다.

- `lib/sms.ts` — 문자 발송 어댑터. `SMS_WEBHOOK_URL`로 `{to, text}` JSON POST. **실제 문자 업체는 미정** — 업체 API가 이 형식과 다르면 이 파일의 `sendSms`만 교체하면 된다. 미설정 시 발송하지 않고 `false` 반환(코드를 로그·응답에 남기지 않음)
- `lib/models/PasswordReset.ts` — 전화번호당 1건, 인증번호는 **해시로 저장**, 5분 TTL, 틀린 시도 횟수 기록
- `lib/password.ts` — 비밀번호 규칙(8자 이상, 72바이트 이하), 번호 정규화, 해시·비교
- `POST /api/v1/auth/password/forgot` — 가입 여부와 무관하게 항상 같은 응답(번호 존재 노출 방지). 60초 재발송 제한, IP당 10회/10분·번호당 5회/시간
- `POST /api/v1/auth/password/reset` — 인증번호 확인 후 새 비밀번호 설정. 최대 5회 시도, 인증번호 1회용, 성공 시 `phoneVerified=true`. 자동 로그인은 하지 않음
- `POST /api/v1/me/password` — 로그인 회원의 비밀번호 변경(현재 비밀번호 확인 필수)
- 화면: `/forgot-password`(2단계), `/me/password`(사이드바 "비밀번호 변경"), 로그인 화면에 "비밀번호를 잊으셨나요?" 링크·변경 완료 안내
- 가입(`auth/customer/signup`): 서버에서도 비밀번호 규칙 검사 추가, **가입 인증번호도 같은 어댑터로 문자 발송**(그동안은 어디로도 발송되지 않고 DB에서 직접 확인하던 임시 구조였음)

**중요:** 문자 업체는 비용 문제로 도입하지 않기로 했으므로 `SMS_WEBHOOK_URL`은 비워 둔다(코드는 남아 있어 나중에 연결 가능). 대신 아래 5-1의 **앱 알림**으로 인증번호를 전달한다. 가입 인증번호는 여전히 문자 전용이라 **문자가 없으면 신규 자가가입은 인증번호를 받을 수 없다**(기존과 같은 상태).

### 5-1. 앱 알림(웹 푸시)으로 인증번호 받기

- `npm install web-push`(+ `-D @types/web-push`) — `package.json`·`package-lock.json` 변경됨. 배포 시 `npm ci` 필요
- `lib/push.ts` — VAPID 설정, `sendPush()`, endpoint **허용 목록**(FCM·Mozilla·Apple·Windows 푸시 도메인만; 클라이언트가 준 URL로 서버가 요청하므로 SSRF 방어). `isPushConfigured()`가 false면 전부 비활성
- `lib/models/PushDevice.ts` — 전화번호에 묶인 기기 구독. 기기(endpoint)는 한 번호에만, 번호당 최대 3대(오래된 것 교체)
- `GET /api/v1/push/public-key` — 브라우저가 구독할 때 쓰는 공개키(미설정 시 503)
- `POST /api/v1/auth/push/register` — 로그인 전 기기 등록. 가입 여부와 무관하게 같은 응답. **`role==="user"`(일반 고객) 번호만 저장**. 이미 다른 기기가 등록돼 있으면 기존 기기들에 "새 기기에서 비밀번호 찾기가 요청되었습니다" 알림 발송. IP당 10회/10분, 번호당 5회/시간
- `POST /api/v1/auth/password/forgot` — 인증번호를 (a) 등록된 기기로 푸시, (b) 문자(설정된 경우)로 발송. 만료된 구독(404/410)은 자동 삭제. **푸시는 일반 고객 계정에만** 발송
- `public/sw.js` — `push`(알림 표시)·`notificationclick`(앱/페이지 열기) 핸들러 추가
- `/forgot-password` — "인증번호 받기" 클릭 시 알림 허용 요청 → 이 기기를 등록 → 인증번호 요청. 알림 거부·미지원이면 안내 문구 표시

**앱 알림 설정**
```bash
node -e "const w=require('web-push');console.log(w.generateVAPIDKeys())"
# 출력된 publicKey / privateKey를 환경변수로:
#   VAPID_PUBLIC_KEY=...  VAPID_PRIVATE_KEY=...  VAPID_SUBJECT=mailto:운영자메일@도메인
```
키는 한 번 정하면 **바꾸지 말 것**(바꾸면 등록된 모든 기기의 구독이 무효가 된다).

**⚠ 보안상 알려진 한계 (의도적으로 수용한 것)**
문자와 달리 앱 알림은 "이 기기가 그 전화번호의 주인이다"를 증명하지 못한다. 로그인 전에 번호만 입력해 기기를 등록하므로, **전화번호를 아는 사람이 자기 폰에서 그 번호의 비밀번호를 재설정할 수 있다**(포인트 탈취 가능). 완화책만 넣었다:
- 소유자·운영자·매장 관리자 계정은 이 방식에서 제외(일반 고객만)
- 기존 등록 기기에 새 기기 등록 알림, 번호당 기기 3대 제한, 요청 횟수 제한, 인증번호 1회용·5회 시도
- 근본 해결은 아니다. 필요하면 다음 중 하나를 추가할 것: 매장 카운터에서 본인확인 후 발급하는 1회용 재설정 QR, 재설정 후 포인트 사용에 추가 확인, 문자 인증 도입

**⚠ 안드로이드 앱(TWA)에서 알림이 뜨려면 (실기기 확인 필요)**
- 현재 배포 중인 APK가 알림 위임(notification delegation)을 켜고 만들어졌는지 확인하지 못했다. 꺼져 있으면 앱 안에서 알림 허용 창이 안 뜨거나 알림이 오지 않을 수 있다. 그 경우 TWA를 재빌드해야 한다(Bubblewrap의 `enableNotifications: true` 등)
- 앱 대신 **크롬 브라우저/홈 화면에 추가한 웹앱**에서는 별도 조치 없이 동작한다(안드로이드). 아이폰은 **홈 화면에 추가한 웹앱**(iOS 16.4+)에서만 웹 푸시가 된다
- 폰의 방해금지·앱 알림 차단 설정이 켜져 있으면 인증번호 알림이 보이지 않는다

## 5-2. 고객사/매장 관리모드 진입 + 현재 위치 표시

요구: 운영자(고객사) 대시보드에서 소속 매장 목록을 보고, 매장을 눌러 **매장 관리자 권한으로** 들어가 관리한다. 운영자 화면 상단에 "어느 고객사", 매장 화면 상단에 "어느 고객사 › 어느 매장"을 항상 표시한다.

- **`GET /api/v1/stores` 범위 제한(보안 수정)** — 예전엔 로그인한 누구나(고객 포함) 모든 고객사의 매장 목록을 받았다. 이제 `requireCompanyAdmin`: 운영자=자기 고객사 매장만, 소유자=전체(또는 `?companyId=`). 응답에 `companyId`·`companyName` 포함
- **`lib/store-context.ts` 재작성** — 소유자·운영자는 `pm_store` 쿠키(httpOnly)에 담긴 "현재 매장"을 쓴다. 쿠키가 없을 때만 `?storeId=` 인정. **매 요청마다** 매장 존재·소속 고객사를 다시 검증(운영자가 다른 고객사 매장 ID로 바꿔도 null). manager는 자기 매장 고정. 내부에서 `dbConnect()` 호출
- **`GET /store/enter?storeId=`** (`app/store/enter/route.ts`) — 소속 확인 후 쿠키 저장·`/store`로 302. 링크는 `<a>`로 걸 것(`next/link` 미리읽기가 쿠키를 바꾸지 않게). 권한 없으면 `/hq`·`/owner`·`/me`로
- **왜 쿠키인가:** 매장 화면 사이드바 링크에 `?storeId=`가 없어서 운영자가 매장 화면 안에서 메뉴를 옮기면 컨텍스트를 잃고 `/me`로 튕겼다. 쿠키로 유지
- **`app/components/ContextBar.tsx` + `globals.css`(`.context-bar`)** — 상단 고정 표시줄(진한 남색, 고객사 칩 › 매장 칩(금색))
  - `/hq`: `고객사 [이름]`(소유자도 들어온 고객사 이름 — 5-5 참고), 고객사 미배정 운영자=빨간 경고
  - `/store`: `고객사 [이름] › 매장 [이름]` + "운영자/소유자가 매장 관리자 권한으로 관리 중" + "← 매장 목록으로"(운영자·소유자만)
- **`/hq` 대시보드** — 소속 매장 목록, 소유자는 고객사별로 묶어서 표시, 각 매장에 "매장 관리모드 열기" 버튼
- **`/store` 레이아웃** — 현재 매장이 없는 소유자·운영자는 `/hq`(`/owner`)로 보냄. "POS 결제 터미널" 메뉴는 manager에게만 표시(운영자·소유자는 `/pos` 접근 불가였음)
- **`/hq/stores`(매장 생성)** — 소유자는 고객사를 선택해야 한다(기존엔 API가 `COMPANY_ID_REQUIRED`를 돌려주는데 화면이 보내지 않아 **소유자는 매장을 만들 수 없었다**). 운영자는 자기 고객사에 자동 생성
- `/hq/vendor` 매장 선택 목록에 고객사 이름 병기(소유자가 여러 고객사를 볼 때)

**주의**
- 운영자/소유자가 매장 관리모드에서 한 작업은 감사로그에 기존 actorType(`STORE_ADMIN`/`HQ_ADMIN`)으로 남는다. "누가(운영자) 어느 매장에서 대신 했는지"를 구분해 남기는 것은 아직 하지 않았다
- `pm_store` 쿠키는 로그아웃해도 브라우저에 남지만, 세션이 없으면 쓰이지 않고 다른 계정으로 로그인해도 매 요청 권한 검증을 거친다
- 로그인 이후 화면(레이아웃·대시보드·진입 흐름)은 DB가 없어 실행해 보지 못했다. 빌드·타입체크와 비로그인 접근 제어(302/307)만 확인

## 5-3. 손님 계정 비밀번호 비움 → 첫 로그인 후 고객 모드에서 설정

배경: 일괄 이전·POS 적립으로 만들어진 손님 계정은 무작위 비밀번호라 본인이 로그인할 수 없었다(적립·사용은 계산원이 전화번호로 처리해 문제없지만, 고객 화면에서 포인트를 보려면 로그인이 필요).

- `User.passwordHash`는 `""`(미설정) 허용(`required` 제거, `default: ""`). `getOrCreateUserByPhone`은 이제 빈 값으로 만든다
- **로그인(`POST /api/v1/auth/login`)**: 비밀번호가 비어 있는 계정은 **전화번호만 넣고 비밀번호를 비워야** 로그인된다. `role==="user"`(일반 고객)에만 허용 — 소유자·운영자·매장 관리자는 항상 비밀번호 필요. 이때 세션에 `pwUnset: true`가 실리고 응답에 `passwordUnset: true`. 전화번호는 하이픈 등을 넣어도 찾는다(원문·숫자만 둘 다 조회)
- **`/me`·`/me/history`**: `pwUnset` 세션이면 `/me/password`로 보낸다(비밀번호를 정할 때까지 고객 화면 사용 불가)
- **`POST /api/v1/me/password`**: DB의 `passwordHash`가 비어 있으면 "처음 정하기"로 보고 현재 비밀번호 확인 없이 설정, 끝나면 `pwUnset` 없는 새 세션 쿠키로 교체. 비어 있지 않으면 기존처럼 현재 비밀번호 확인 필수
- `/me/password` 화면은 처음이면 "비밀번호 정하기"(현재 비밀번호 칸 숨김) 후 `/me`로 이동
- 로그인 화면: 비밀번호 칸을 필수에서 뺐고 "매장에서 포인트가 적립되어 처음 로그인하시는 분은 비워두세요" 안내. 가입 화면: 이미 등록된 번호면(매장에서 만들어진 계정 포함) 로그인 방법 안내
- **기존 DB의 이전 계정 처리 — `scripts/blank-imported-passwords.ts`(작성만, 실행은 운영 서버에서 사람이):** 기본 미리보기, `--apply`로 반영. 대상은 `role==="user"` + `name==="포인트 손님"` + `phoneVerified!==true` + 비밀번호가 비어 있지 않은 계정. 본인이 가입했거나 비밀번호를 재설정한 계정과 권한 계정은 건드리지 않는다. **미리보기에서 대상 수가 예상과 맞는지 먼저 확인할 것**

**⚠ 보안상 알려진 한계 (요청에 따라 의도적으로 수용)**
비밀번호가 비어 있는 계정은 **그 전화번호를 아는 사람이 먼저 로그인해 비밀번호를 정하면 그 사람이 계정을 차지**한다(정당한 손님은 이후 로그인 불가 → 비밀번호 찾기 필요). 신원 근거가 전화번호뿐이라는 기존 설계(카드 미신원)와 같은 수준의 위험이다. 완화: 일반 고객 계정만, 로그인 시도 IP당 20회·번호당 10회/10분 제한, 권한 계정 제외. 근본 대책이 필요하면 매장 카운터 확인 후 발급하는 1회용 설정 링크 등을 검토할 것

## 5-4. 적립 비율 설정 제거

적립 비율은 포스기 프로그램에서 관리하므로 이 프로그램에서는 설정·계산하지 않는다.

- `Store.pointPolicy`(earnRate) **필드 삭제**. 이미 DB에 저장된 값은 남지만 코드가 읽지 않는다(정리 불필요)
- `/store/consent`의 "적립률" 카드와 `PUT/GET .../pos-integration/scopes`의 `earnRate`·`pointPolicy` 제거(감사로그 meta에서도 제거). 동의 항목 문구 "결제금액 기준 적립" → "적립 처리"
- **카운터 수동 적립(`POST /api/v1/pos/earn`, `/pos` 화면)**: 결제금액×비율 계산을 없애고 **적립할 포인트를 직접 입력**하는 방식으로 변경. 요청 필드 `saleAmount` → **`earnAmount`**(포인트). 화면에 "포스기 프로그램이 자동 적립하지 못한 경우의 보조 기능" 안내. 정상 경로(포스기 에이전트 → `posAgentEarn`)는 원래 포스가 계산한 적립액을 그대로 반영하므로 영향 없음
- **구 벤더 동기화(`applyVendorSync`, `POST /api/v1/pos/vendor-sync`)**: 비율로 계산하던 `PAYMENT` 이벤트 타입 삭제. 알 수 없는 타입은 이제 **무시**된다(예전 else 분기가 "사용"으로 처리하던 것을 `USE`만 명시적으로 처리하도록 바꿔 오인 차감 방지). 현재 에이전트(`point-terminal-agent.ps1`)는 이 경로를 쓰지 않는다

## 5-5. 소유자 → 본사(고객사) 관리모드 → 매장 관리모드 (3단계 진입)

요구: 슈퍼관리자인 소유자는 운영자·매장 관리자 권한을 모두 갖는다. 소유자 대시보드에서 고객사 목록을 보고 클릭해 본사 관리모드로 들어가고, 본사 관리모드 대시보드에서는 그 고객사의 매장 목록이 나오며 클릭하면 매장 관리모드로 들어간다.

- **`pm_company` 쿠키 + `lib/company-context.ts`** — `resolveCompanyId(session)`: 운영자=자기 고객사, 소유자=본사 관리모드에 들어간 고객사(쿠키, 존재 여부 매번 재확인). 매장의 `pm_store` 쿠키와 같은 방식
- **`GET /hq/enter?companyId=`** (`app/hq/enter/route.ts`) — 소유자만. 고객사 확인 후 쿠키 저장·`/hq`로 302. 링크는 `<a>`로 걸 것
- **소유자 대시보드 `/owner`** — 고객사 목록의 각 행에 "본사 관리모드 열기" 버튼(+ 기존 이름 변경)
- **`/hq` 레이아웃** — 소유자가 고객사를 고르지 않고 오면 `/owner`로 보냄. 상단 표시줄에 항상 `고객사 [이름]`(소유자는 "소유자가 운영자 권한으로 관리 중" + "← 고객사 목록으로")
- **`/hq` 대시보드** — 소유자도 들어온 고객사 **하나**의 매장 목록만 보임(예전엔 전체를 고객사별로 묶어서 보여줌). 각 매장 "매장 관리모드 열기" → `/store/enter`
- **`/store/enter`** — 소유자가 매장에 들어가면 그 매장의 고객사도 `pm_company`로 맞춘다("← 매장 목록으로"가 같은 고객사로 돌아가게)
- **`GET/POST /api/v1/stores`** — 소유자의 범위: `?companyId=` → 현재 본사 관리모드 고객사 → (둘 다 없으면) 전체. 매장 생성은 현재 고객사에 자동(그래서 `/hq/stores`의 고객사 선택 칸 제거)
- **소유자에게 매장 관리자 권한 전부 부여** — `requireOwnStore()`(POS 결제·조회·카드연결·QR 발급 라우트 6개가 사용)가 소유자일 때 **들어가 있는 매장**을 "내 매장"으로 취급한다(권한은 매번 재검증). `/pos` 화면도 소유자는 매장에 들어가 있으면 열린다. **운영자(admin)는 결제 같은 매장 운영 동작은 하지 않는다**(설정·조회만) — 의도적으로 소유자에게만 부여
- **`/hq/applications` → `/owner/applications`로 이동**(소유자 전용이라 고객사 컨텍스트가 필요한 `/hq` 아래에 둘 수 없음). API(`/api/v1/hq/store-applications`)는 그대로
- 소유자 화면에서 "운영자 모드" 바로가기 제거(고객사를 골라 들어가야 하므로). 운영자 사이드바 "포인트 관리" → "통합포인트 관리"(용어 규칙)

**주의**
- 소유자가 매장 관리모드에서 한 결제·적립 등은 감사로그에 그 소유자의 ID로 남는다. "소유자가 대신 처리"한 것을 별도 표시하지는 않는다
- 로그인 이후 화면·진입 흐름은 DB가 없어 실행해 보지 못했다(빌드·타입체크, 비로그인 접근 제어만 확인)

## 6. 검증 못 한 것 / 알려진 한계

- **PowerShell 스크립트는 실행해 보지 못했다**(클라우드에 `pwsh` 없음). 코드 리뷰로만 확인. 실기기 테스트 필요
- DB 접근이 없어 마이그레이션·토큰 등록·비밀번호 재설정 흐름은 모두 미실행. **웹 푸시도 실제 기기로 발송해 보지 못했다**(엔드포인트 허용 목록 로직만 단독 테스트)
- `npm audit`에 취약점 5건(critical 1, high 3, moderate 1)이 보이지만 `web-push` 추가 전에도 같았다(기존 의존성). 이 변경과 무관
- 세션이 JWT(7일)라 비밀번호를 바꿔도 **다른 기기의 기존 로그인은 유지된다**. 강제 로그아웃이 필요하면 `passwordChangedAt` 필드를 두고 세션 검증에서 비교하는 방식을 추가해야 한다
- `app/store/consent/ConsentClient.tsx` 85행에 사용자 화면용 도메인 표기가 남아 있다(용어 규칙 위반, 기존 코드라 손대지 않음)
- 문서 밖 상태: `uploads/pos-agent/point-terminal-agent.zip`은 더 이상 쓰이지 않는다(삭제 가능)

## 7. 커밋 이력

- `f4397e4` RBAC 정리 + `/owner` + 마이그레이션 스크립트 + 원샷 설치 서버 쪽
- `cf0cd76` 에이전트 재작성(원샷 설치)
- `2947b60` 비밀번호 찾기·변경(문자 방식) + 이 문서
- `4ea8fa7` 앱 알림(웹 푸시)으로 인증번호 전달, `web-push` 의존성 추가
- `b1f35d0` 고객사/매장 관리모드 진입 + 현재 고객사·매장 표시줄
- `1574b66` 손님 계정 비밀번호 비움·첫 로그인 후 설정, 적립 비율 설정 제거
- (다음 커밋) 소유자 → 본사 관리모드 → 매장 관리모드 3단계 진입, 소유자에게 매장 관리자 권한 부여
