# 움막AI 배포 지시서 (최종)

브랜치: `claude/sleepy-darwin-0zm54g` (concrab 소스만 담은 **별개 git history**. wiigle과 무관, PR/머지 대상 없음)
먼저 `docs/CHANGES-cloud-session.md`의 **0절(용어)** 과 **1절(배포 절차)** 을 읽으세요.

## 원칙
- 운영 서버의 **실제 데이터**입니다. 파괴적이거나 되돌리기 어려운 단계는 **사용자 확인 후** 진행하세요.
- 모든 스크립트는 기본이 **미리보기(dry-run)** 입니다. 결과를 사용자에게 보여주고 승인받은 뒤에만 `--apply` 하세요.
- 비밀번호·토큰·키를 저장소·문서·커밋에 적지 마세요. 환경변수로만 사용하세요.
- `git push --force`, 다른 브랜치로의 push, `git reset --hard`(사용자 확인 없이)는 하지 마세요.

## 1. 사전 점검과 백업
```bash
cd <서버 앱 디렉터리>
git status
git log --oneline -3
git remote -v          # origin = https://github.com/plajart/wiigle
```
- **서버에서 직접 수정한 내용이 있는지** 확인하세요(`git status`, `git diff`). 이 저장소에는 서버의 로컬 수정이 반영돼 있지 않을 수 있습니다.
  - 있으면: `git diff > ~/server-local-$(date +%Y%m%d).patch` 로 저장하고, 내용을 사용자에게 보여주세요. 새 버전에 이미 반영된 내용인지(용어·계정·포인트·비밀번호·다운로드 흐름 등) 비교해서 **어떻게 합칠지 사용자에게 확인**하세요. 확인 전에는 pull 하지 마세요.
- **백업 (필수):**
  ```bash
  mongodump --uri="$MONGODB_URI" --out ~/backup-$(date +%Y%m%d-%H%M)
  tar czf ~/app-backup-$(date +%Y%m%d-%H%M).tgz <서버 앱 디렉터리>   # uploads/, .env* 포함(이 파일들은 git에 없음)
  ```

## 2. 최신 코드 가져오기 (pull)
```bash
git fetch origin claude/sleepy-darwin-0zm54g
git log --oneline HEAD..origin/claude/sleepy-darwin-0zm54g     # 받게 될 커밋 목록 확인
git checkout claude/sleepy-darwin-0zm54g                         # 이미 이 브랜치면 생략
git merge --ff-only origin/claude/sleepy-darwin-0zm54g           # 또는 git pull --ff-only origin claude/sleepy-darwin-0zm54g
git log --oneline -1                                             # 사용자가 알려준 최신 커밋 해시와 같아야 함
```
- `--ff-only`가 실패하면(서버 히스토리와 갈라짐) **강제로 맞추지 말고** 상태를 사용자에게 보고하세요.
- `uploads/`, `.env*`, `node_modules`는 git에 없으므로 pull로 지워지지 않습니다.

## 3. 환경변수 확인
| 이름 | 용도 |
|---|---|
| `MONGODB_URI` | 기존 값 그대로 |
| `NEXTAUTH_SECRET` | **기존 값 유지**(바꾸면 모든 사용자가 로그아웃됨) |
| `APP_BASE_URL` | `https://concrab.com` — 포스 프로그램 zip의 접속 주소와 대표 포스기 바로가기 주소 |
| `VAPID_PUBLIC_KEY` `VAPID_PRIVATE_KEY` `VAPID_SUBJECT` | 선택 — 앱 알림(웹 푸시). 없으면 앱 알림 기능만 꺼짐 |
| `SMS_WEBHOOK_URL` `SMS_WEBHOOK_TOKEN` | 선택 — 문자 발송. 지금은 비워 둠 |
| `FIXED_PASSWORD` | **스크립트 실행 때만** 사용(아래 5-d). 앱에는 필요 없음 |

## 4. 빌드
```bash
npm ci
npm run build          # 실패하면 중단하고 오류를 사용자에게 보고
```

## 5. DB 마이그레이션 — **새 앱을 시작하기 전에**, 순서대로
각 스크립트를 먼저 `--apply` 없이 실행해 "변경 예정 개수"를 확인하세요. 이미 반영된 항목이면 변경 0으로 나오므로 건너뛰면 됩니다.

a) `MONGODB_URI=... npx tsx scripts/migrate-to-multitenant.ts` — 고객사·매장 소속, 권한 등급 변환
b) `MONGODB_URI=... npx tsx scripts/migrate-company-points.ts` — 통합포인트를 고객사 단위로 분리.
   기존 통합포인트 잔액이 0이 아니면 미리보기가 개수·합계를 알려줍니다 → **어느 고객사로 귀속할지 사용자에게 확인**한 뒤 `--assign-hq-to="고객사 이름" --apply`.
   (이 단계가 옛 유니크 인덱스를 지웁니다. **앱 시작 전에** 해야 합니다.)
c) `MONGODB_URI=... npx tsx scripts/issue-initial-passwords.ts` — POS로 만들어진 손님 계정에 임의 초기 비밀번호 부여
d) `MONGODB_URI=... FIXED_PASSWORD='<사용자가 정한 비밀번호>' npx tsx scripts/setup-accounts.ts` — 계정 4개 정리
   - 대상: `01035587496`(이름 '배병철' 확인 → 본사=owner), `01000000000`(본사 owner), `01000000001`(반들한식뷔페 **고객사 운영자**=admin), `01000000002`(반들한식뷔페 **매장 관리자**=manager). 네 계정 모두 같은 비밀번호.
   - ⚠ **이미 계정을 설정해 두었다면**, 이 스크립트를 다시 `--apply`하면 **비밀번호가 다시 덮어써지고 첫 로그인 변경 안내가 다시 켜집니다.** 사용자가 그 사이 비밀번호를 바꿨는지 확인한 뒤에만 실행하세요. 미리보기에서 각 계정의 현재 role이 목표와 같으면 실행할 필요가 없습니다.
   - `01035587496`의 이름이 '배병철'이 아니면 스크립트가 아무것도 바꾸지 않고 멈춥니다 → 사용자에게 보고.
   - "더파티 시청점"은 계정 없이 정보만 두는 방침입니다. 그 매장·고객사에 묶인 계정이 출력되면 **수정하지 말고** 사용자에게 처리 방침을 물어보세요.

## 6. 재시작
기존 방식대로 재시작하세요(`reapp.sh` 등). 시작 로그에 오류가 없는지 확인하세요.

## 7. 동작 확인 (브라우저에서)
1. `01000000000` 로그인 → (첫 로그인 안내가 나오면 정상) → 본사 관리모드 → 고객사 목록 → **반들한식뷔페 → 고객사 관리모드** → 매장 목록 → **매장 관리모드**. 각 화면 상단에 `고객사 › 매장`이 표시되는지.
2. `01000000001` 로그인 → 고객사 관리모드에서 매장·관리자 화면이 열리는지.
3. `01000000002` 로그인 → 매장 관리모드 → **포스기 다운로드** → zip이 받아지고 그 안에 `provision.json`이 있는지.
4. `01035587496` 로그인 → 본사 관리모드/고객사/매장 화면이 모두 열리는지.
5. 고객 화면: 로그인 화면의 "처음 로그인하시나요? 초기 비밀번호 확인" → 로그인 → 비밀번호 변경 안내 1회 → 이후 안내가 다시 나오지 않는지. `/me`에서 **고객사별 카드**로 포인트가 보이는지.
6. 포스기(실기기, 사용자가 진행): 매장 계정으로 로그인해 zip을 받아 압축을 풀고 `start.bat` 실행 → 등록·초기화 → 포스기 목록 창. 첫 포스기가 "대표", 두 번째부터는 대표가 아님.

## 8. 문제가 생기면
- 코드: 이전 커밋으로 되돌리고 재시작(`git checkout <이전 커밋>` → `npm ci` → `npm run build`).
- DB: `mongodump` 백업으로 복원. **마이그레이션(특히 b)은 인덱스를 교체하므로** 코드만 되돌리면 안 되고 백업 복원이 필요할 수 있습니다.

## 9. 사용자에게 보고할 것
- pull 전후 커밋 해시, 서버 로컬 수정 유무와 처리 결과
- 각 마이그레이션 미리보기·반영 결과(개수), 건너뛴 단계와 이유
- 7번 동작 확인 결과(통과/실패)
- 오류·경고 로그, 사용자 결정이 필요한 항목
