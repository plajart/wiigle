/**
 * 운영 점검 리포트(읽기 전용) — 본사 관리모드 "운영 점검·복구" 화면과 같은 점검 데이터를 터미널에 출력한다. DB를 바꾸지 않는다.
 * 움막AI 가 시범 기간에 매일 확인하는 용도(본사 로그인 없이 서버에서 실행).
 *
 *   MONGODB_URI="mongodb://..." NODE_OPTIONS="--conditions=react-server" [COMPANY_ID=…] [STORE_ID=…] [HOURS=24] [PHONE=01000000000] \
 *     npx tsx scripts/ops-report.ts
 *
 * PHONE 을 주면 그 고객의 계좌·최근 내역·포스 이동 기록도 출력한다. (NODE_OPTIONS 는 lib 의 server-only 를 스크립트에서 불러오기 위한 것)
 */
import { getOpsReview, getCustomerOps } from "../lib/ops-review";

const line = (s = "") => console.log(s);

async function main() {
  if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI 환경변수가 필요합니다");
  const r = await getOpsReview({ companyId: process.env.COMPANY_ID || undefined, storeId: process.env.STORE_ID || undefined, hours: Number(process.env.HOURS) || 24 });
  line(`== 운영 점검 (${r.generatedAt}, 최근 ${r.hours}시간) · 최신 에이전트 버전 ${r.expectedVersion ?? "?"}`);
  line(`바로 확인할 항목 ${r.summary.critical}건 / 주의 ${r.summary.warn}건 / 포스기 ${r.summary.online}/${r.summary.terminals}대 연결 / 오프라인 후 반영 ${r.summary.offlineDelayedEvents}건`);
  line(`긴급 스위치: 자동 반영 ${r.switches.autoInjectAllowed ? "허용" : "중지됨"}, 포인트 사용 ${r.switches.redeemPaused ? "일시 중지 중" : "가능"}`);
  line(`내역 요약: ${r.summary.events.map((e) => `${e.type} ${e.count}건(${Math.round(e.amount)}P)`).join(", ") || "없음"}`);
  line();
  line("-- 포스기");
  for (const t of r.terminals) {
    line(`${t.online ? "●" : "○"} ${t.companyName} › ${t.storeName} › ${t.name} | v${t.agentVersion ?? "-"}${t.isLatest ? "(최신)" : ""} | 자동반영 ${t.autoInject === null ? "-" : t.autoInject ? "켬" : "끔"} | 미전송 ${t.pending} | 마지막 연결 ${t.lastSeenAt ? new Date(t.lastSeenAt).toISOString() : "-"}`);
    for (const f of t.flags) line(`    ! ${f.text}`);
  }
  const sect = (title: string, rows: string[]) => {
    line();
    line(`-- ${title} (${rows.length})`);
    for (const x of rows) line("  " + x);
  };
  sect("이전 보류", r.issues.importHolds.map((h) => `${h.storeName}/${h.terminalName} ${h.phone} 포스 ${h.balance} 더해질 ${h.amount} 기준 ${h.previous} [${h.kind}]`));
  sect("마이너스 계좌", r.issues.negativeAccounts.map((a) => `${a.companyName}/${a.storeName} ${a.phone} ${a.balance}`));
  sect("잔액 부족 차감", r.issues.shortfalls.map((s) => `${new Date(s.occurredAt).toISOString()} ${s.storeName}/${s.terminalName} ${s.phone} ${s.amount}`));
  sect("서버 거부/보류", r.issues.rejectedOrSkipped.map((t) => `${new Date(t.recordedAt).toISOString()} ${t.kind} ${t.storeName}/${t.terminalName} ${t.phone} ${t.amount} ${t.note}`));
  sect("오래 남은 반영", r.issues.stuckSwaps.map((s) => `${s.storeName}/${s.terminalName} ${s.phone} ${s.amount} ${s.minutesAgo}분 전`));
  sect("걸린 잠금", r.issues.locks.map((l) => `${l.storeName}/${l.terminalName} ${l.phone} ${l.heldSec}초`));

  const phone = (process.env.PHONE ?? "").replace(/[^0-9]/g, "");
  if (phone) {
    const c = await getCustomerOps(phone);
    line();
    if (!c) line(`-- 고객 ${phone}: 없음`);
    else {
      line(`-- 고객 ${c.user.phone} ${c.user.name}`);
      for (const a of c.accounts) line(`  계좌 ${a.companyName} / ${a.storeName}: ${a.balance}`);
      for (const e of c.events.slice(0, 30)) line(`  내역 ${new Date(e.occurredAt).toISOString()} ${e.type} ${e.amount} ${e.storeName} ${e.terminalName ?? ""}${e.reversedBy ? " [되돌려짐]" : ""}${e.reversalOf ? " [되돌리기 내역]" : ""} ${e.reason}`);
      for (const t of c.transfers.slice(0, 30)) line(`  이동 ${new Date(t.recordedAt).toISOString()} ${t.kind} ${t.amount} ${t.storeName}/${t.terminalName} 포스 ${t.localBefore ?? "-"}→${t.localAfter ?? "-"} 서버 ${t.serverBalanceAfter ?? "-"} ${t.note}`);
    }
  }
  const { default: mongoose } = await import("mongoose");
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
