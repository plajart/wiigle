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
   - 미리보기에서 "고객사가 없는 매장 N개" 경고가 나오면 수동 지정 필요(`companyId`는 필수).
4. 서버 재시작 (권한 체계·등록 방식이 바뀌었으므로)
5. 모든 사용자는 **재로그인** 필요(세션이 JWT라 role 변경이 즉시 반영되지 않음)

### 환경변수
| 이름 | 용도 |
|---|---|
| `MONGODB_URI` | 기존과 동일 |
| `APP_BASE_URL` | 포스 프로그램 zip에 내장되는 접속 주소. 없으면 요청 origin. 프록시 뒤라면 반드시 설정 |
| `SMS_WEBHOOK_URL` | **신규.** 문자 발송 게이트웨이 주소. 비밀번호 찾기·가입 인증번호 발송에 필요. 없으면 문자가 나가지 않음 |
| `SMS_WEBHOOK_TOKEN` | **신규(선택).** 있으면 `Authorization: Bearer` 로 전송 |

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

**중요:** `SMS_WEBHOOK_URL`을 설정하지 않으면 비밀번호 찾기·가입 인증번호가 고객에게 도달하지 않는다. 기능은 문자 업체 연결 후에 실제로 쓸 수 있다.

## 6. 검증 못 한 것 / 알려진 한계

- **PowerShell 스크립트는 실행해 보지 못했다**(클라우드에 `pwsh` 없음). 코드 리뷰로만 확인. 실기기 테스트 필요
- DB 접근이 없어 마이그레이션·토큰 등록·비밀번호 재설정 흐름은 모두 미실행
- 세션이 JWT(7일)라 비밀번호를 바꿔도 **다른 기기의 기존 로그인은 유지된다**. 강제 로그아웃이 필요하면 `passwordChangedAt` 필드를 두고 세션 검증에서 비교하는 방식을 추가해야 한다
- `app/store/consent/ConsentClient.tsx` 85행에 사용자 화면용 도메인 표기가 남아 있다(용어 규칙 위반, 기존 코드라 손대지 않음)
- 문서 밖 상태: `uploads/pos-agent/point-terminal-agent.zip`은 더 이상 쓰이지 않는다(삭제 가능)

## 7. 커밋 이력

- `f4397e4` RBAC 정리 + `/owner` + 마이그레이션 스크립트 + 원샷 설치 서버 쪽
- `cf0cd76` 에이전트 재작성(원샷 설치)
- (다음 커밋) 비밀번호 찾기·변경 + 이 문서
