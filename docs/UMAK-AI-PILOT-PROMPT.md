# 움막AI 최종 지시서 — 배포 · 점검 · 더파티 한 매장 시범 도입

(클라우드 AI 가 작성. 브랜치 `claude/sleepy-darwin-0zm54g`, 마지막 코드 커밋 `931ba4c`, 에이전트 기대 버전 `0b9502d01fe5`.
이 지시서 아래의 `docs/OPS-RUNBOOK.md`(운영 절차), `docs/UMAK-AI-DEPLOY-PROMPT.md`(배포 방법: 서버가 git 저장소가 아닐 때 포함)를 함께 읽고 따르세요.)

## 원칙 (모두 지킬 것)
- 운영 DB 는 **읽기 전용 조회만** 합니다(마이그레이션·UPDATE·DELETE·DROP 금지). 배포는 파일 반영(rsync, `--delete` 금지, `PointManager.exe` 유지)과 재시작뿐입니다. 이번 변경에는 DB 마이그레이션이 없습니다.
- 비밀값(`MONGODB_URI`, 비밀번호, API 키)은 출력·기록·전달하지 마세요.
- **반들한식뷔페**(개발 중 어긋난 포인트)는 사용자가 직접 살펴보고 보정합니다 — 데이터는 건드리지 말고 조회 결과만 보고하세요.
- 문제가 생기면 즉시 멈추고 원문(로그·SQL 결과·화면)을 이 세션(클라우드 AI)에 보고하세요. 추측으로 고치지 마세요.

## 1. 백업 (배포 전, 반드시 먼저)
`mongodump --uri="$MONGODB_URI" --gzip --archive=/root/backups/pm-$(date +%Y%m%d-%H%M).archive.gz` 후 파일 크기·존재를 확인해 보고. 백업 없이 배포하지 않습니다.

## 2. 배포 (서버 코드 + 포스 에이전트가 모두 바뀜)
`docs/UMAK-AI-DEPLOY-PROMPT.md` 절차대로 `/web/concrab`(파드의 `/app`)에 반영하고 빌드·재시작(reapp.sh). 확인:
- 서비스 폴더에서 `grep -c "reversalOf" lib/models/PointEvent.ts`, `grep -c "ImportHold" lib/points.ts`, `ls app/owner/ops app/api/v1/owner/ops` 가 있는지, `grep -c "Show-PaymentResult\|PmToastForm\|Undo-WrongInjection\|ChampWatch" pos-agent-src/point-terminal-agent.ps1` 가 4 이상인지.
- `curl -s https://concrab.com/api/v1/pos/agent/version` 의 version 이 `0b9502d01fe5` 인지(아니면 서비스 폴더에 새 파일이 안 올라간 것). 호스트와 서비스 폴더 파일 sha256sum 일치.
- 로그인 화면·`/store`·`/owner` 가 정상 응답하는지(`curl -I`), 서버 로그에 오류가 없는지.
- **인덱스**: 앱이 시작되면 자동 생성됩니다. Mongo 셸/스크립트로 `pointevents` 인덱스에 `reversalOf_1`(unique, partialFilterExpression) 이 있는지, `importholds` 컬렉션이 생기는지(첫 보류 때 생성) 확인해 보고. 없으면 앱 재시작 후 다시 확인(인덱스를 직접 만들지는 마세요).
- 읽기 전용 점검 리포트로 DB 접속·기능 확인: `MONGODB_URI=... NODE_OPTIONS="--conditions=react-server" npx tsx scripts/ops-report.ts` (선택: `COMPANY_ID`, `STORE_ID`, `HOURS`, `PHONE`). 출력을 원문으로 보고.

## 3. 다대점(개발용 포스) 반영
- 트레이 "업데이트 확인..."으로 최신 버전 적용. 에이전트가 재시작되면 "고객 조회 시 통합포인트 자동 반영 (시험)" 체크가 켜져 있는지 확인(기본 꺼짐, 시험은 켠 채).
- 확인: 알림창이 오른쪽 아래에 뜨고 키 입력·터치를 가로막지 않는지, 같은 폴더에 `swap-state.json` 이 반영 중에만 생기고 정리되면 사라지는지, agent.log 에 "자동 반영" 줄(감지/반영/되돌림/오류, 반영 소요 ms)이 정상인지.
- 사용+적립이 함께 있는 결제 한 건(영업 외 시간, 테스트 고객 배병철 01035587496)으로 확인: 알림이 사용·적립 반영 후 한 번만 최종 잔액으로 뜨는지, 서버 `pointevents` 에 `VENDOR_USE`·`VENDOR_EARN` 이 각각 한 번씩만 있는지, 조회 잠금이 풀렸는지(`redeemlocks` 에 문서가 남지 않음).
- 이전 시험(22:37경 배병철 사용 1,000원·적립 45원)의 서버 장부(이벤트·`postransferlogs`·`pointaccounts` 합계) 보고 — 서버 가용이 약 11,052원인지 12,007원 그대로인지.

## 4. 더파티 한 매장 시범 도입 준비 (사용자가 매장을 정하면 진행, 정하기 전에는 읽기 전용 준비만)
1. 읽기 전용 현황: `ops-report.ts` 로 더파티 고객사·매장·등록된 포스기 목록, 포스기별 에이전트 설치·연결 상태.
2. **포스기끼리 DB 복제 여부 확인(가장 중요)**: 그 매장의 포스기마다(접속 가능한 곳) `powershell -ExecutionPolicy Bypass -File champ-survey.ps1 -Mode Balances` 실행 → 결과의 "지문"과 요약(회원 수·잔액 합계)을 포스기별로 보고. 지문이 같으면 DB 가 복제된 것이라 **한 대만 초기 이전**하고 나머지는 보류 처리해야 합니다(서버도 같은 금액이면 자동 보류). 지문이 다르면 포스기마다 따로 쌓인 포인트라 각각 이전합니다.
3. 설치·초기 이전은 **한 대씩 순서대로**, 첫 대 이전이 끝나면 `ops-report.ts` 로 이전 합계·보류를 보고한 뒤 사용자 확인을 받고 다음 대로 진행합니다. 다른 매장에는 설치하지 않습니다.
4. 대조: 포스 바탕화면 `포인트서버이전백업_*_initial_*.csv` 합계(전화번호 있는 회원만)와 서버 `pointaccounts` 합계가 맞는지 보고.
5. 처음 1~2일은 자동 반영을 끈 채 팝업 방식만 사용 → 이상 없으면 한 대에서만 자동 반영 켬(사용자가 결정).

## 5. 시범 기간 일일 점검 (읽기 전용, 매일 원문 보고)
- `ops-report.ts` 출력(바로 확인할 항목·주의·포스기 연결·이전 보류·마이너스 계좌·잔액 부족 차감·서버 거부/보류·오래 남은 반영·걸린 잠금).
- 이상 징후는 즉시 보고: 알림 안 뜸/입력 가로막힘, 같은 건 중복 반영, 서버 잔액과 챔프 가용 불일치, `RESTORE_POS` 없이 남은 값, 이전 보류 발생, 마이너스 잔액, 결제 취소 시 챔프가 음수 행을 남기는지(`CRAB_EVENT_QUEUE` 의 `MEMP_ADD_AMT`/`MEMP_USED_AMT` 부호).
- **`CRAB_EVENT_QUEUE` 테이블을 지우거나 재생성하지 마세요**(일련번호 초기화로 새 결제가 중복으로 오인돼 누락).
- 조치(되돌리기·보정·보류 처리·긴급 스위치)는 **본사 관리모드 `/owner/ops`** 에서 사용자(본사)가 합니다. 움막AI 는 점검·보고와 DB 백업/복원(본사 승인 후)만 맡습니다.
