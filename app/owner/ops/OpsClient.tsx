"use client";

import { useCallback, useEffect, useState } from "react";

type Opt = { _id: string; name: string; companyId?: string };
type Flag = { level: "critical" | "warn"; text: string };
type TerminalRow = { _id: string; name: string; storeName: string; companyName: string; online: boolean; lastSeenAt: string | null; agentVersion: string | null; isLatest: boolean; autoInject: boolean | null; swapPending: number; pending: number; initialTransferAt: string | null; flags: Flag[] };
type HoldRow = { _id: string; kind: string; storeName: string; terminalName: string; phone: string; customerName: string; balance: number; amount: number; previous: number; createdAt: string; lastSeenAt: string };
type NegRow = { _id: string; userId: string; phone: string; customerName: string; storeName: string; companyName: string; balance: number };
type ShortRow = { _id: string; occurredAt: string; storeName: string; terminalName: string; phone: string; amount: number; vendorTxnId: string };
type RejRow = { _id: string; kind: string; recordedAt: string; storeName: string; terminalName: string; phone: string; amount: number; note: string };
type StuckRow = { storeName: string; terminalName: string; userId: string; phone: string; amount: number; minutesAgo: number };
type LockRow = { userId: string; phone: string; storeName: string; terminalName: string; heldSec: number };
type Review = {
  generatedAt: string;
  hours: number;
  expectedVersion: string | null;
  switches: { autoInjectAllowed: boolean; redeemPaused: boolean };
  options: { companies: Opt[]; stores: Opt[] };
  summary: { critical: number; warn: number; terminals: number; online: number; offlineDelayedEvents: number; events: { type: string; count: number; amount: number }[] };
  terminals: TerminalRow[];
  issues: { importHolds: HoldRow[]; negativeAccounts: NegRow[]; shortfalls: ShortRow[]; rejectedOrSkipped: RejRow[]; stuckSwaps: StuckRow[]; locks: LockRow[] };
};
type CAccount = { _id: string; type: string; companyId: string; companyName: string; storeId: string | null; storeName: string; balance: number };
type CEvent = { _id: string; type: string; amount: number; status: string; occurredAt: string; offline: boolean; companyName: string; storeName: string; terminalName: string | null; reason: string; vendorTxnId: string; reversedBy: string | null; reversalOf: string | null };
type CTransfer = { _id: string; kind: string; amount: number; recordedAt: string; storeName: string; terminalName: string; localBefore: number | null; localAfter: number | null; serverBalanceAfter: number | null; note: string };
type CHold = { _id: string; kind: string; status: string; storeName: string; terminalName: string; balance: number; amount: number; previous: number; createdAt: string };
type Customer = { user: { _id: string; name: string; phone: string; role: string }; accounts: CAccount[]; events: CEvent[]; transfers: CTransfer[]; lock: { storeName: string; terminalName: string; lockedAt: string } | null; holds: CHold[] };

const TYPE_LABEL: Record<string, string> = {
  EARN: "적립", REDEEM: "사용", TRANSFER_OUT: "이체 출금", TRANSFER_IN: "이체 입금", GRANT: "지급", ADJUST: "조정/보정",
  VENDOR_EARN: "적립(포스)", VENDOR_USE: "사용(포스)", VENDOR_IMPORT: "초기 이전", EARN_CANCEL: "적립 취소", USE_CANCEL: "사용 취소(환원)",
};
const KIND_LABEL: Record<string, string> = {
  LOOKUP_TO_POS: "사용 조회(포스에 반영)", RESTORE_POS: "포스 값 되돌림", EARN_TO_SERVER: "적립 → 서버", USE_TO_SERVER: "사용 → 서버", EARN_CANCEL: "적립 취소 반영", USE_CANCEL: "사용 취소 반영",
  BULK_IMPORT: "초기 일괄 이전", INITIAL_DONE: "최초 이전 완료", SKIPPED: "보류(건너뜀)", REJECTED: "서버 거부(건너뜀)",
};
const HOLD_KIND: Record<string, string> = { MORE_THAN_IMPORTED: "이전 기록보다 포스 잔액이 많음", STORE_REPLICA_SUSPECT: "같은 매장 다른 포스기와 중복 의심" };
const ERR: Record<string, string> = {
  REASON_REQUIRED: "사유를 입력해 주세요.", ALREADY_REVERSED: "이미 되돌린 내역입니다.", CANNOT_REVERSE_A_REVERSAL: "되돌리기 내역은 다시 되돌릴 수 없습니다.",
  TRANSFER_REVERSAL_UNSUPPORTED: "이체 내역은 되돌릴 수 없습니다(고객 이체를 직접 정정하세요).", EVENT_NOT_CONFIRMED: "확정된 내역만 되돌릴 수 있습니다.", INVALID_AMOUNT: "금액을 확인해 주세요.",
  ALREADY_RESOLVED: "이미 처리된 건입니다.", STORE_COMPANY_MISMATCH: "매장과 고객사가 맞지 않습니다.", CUSTOMER_NOT_FOUND: "그 전화번호의 고객이 없습니다.", PHONE_REQUIRED: "전화번호를 입력해 주세요.",
};

const fmt = (v: string | null | undefined) => (v ? new Date(v).toLocaleString("ko-KR", { hour12: false }) : "-");
const won = (n: number) => `${Math.round(n).toLocaleString()}P`;

async function api(path: string, init?: RequestInit): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  try {
    const res = await fetch(path, init);
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { ok: res.ok, data };
  } catch {
    return { ok: false, data: { error: "NETWORK" } };
  }
}
const errText = (d: Record<string, unknown>) => ERR[String(d.error)] ?? `처리하지 못했습니다(${String(d.error ?? "오류")}).`;

export default function OpsClient() {
  const [companyId, setCompanyId] = useState("");
  const [storeId, setStoreId] = useState("");
  const [hours, setHours] = useState(24);
  const [review, setReview] = useState<Review | null>(null);
  const [loadErr, setLoadErr] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [phone, setPhone] = useState("");
  const [cust, setCust] = useState<Customer | null>(null);
  const [custMsg, setCustMsg] = useState<string | null>(null);
  const [adj, setAdj] = useState({ accountId: "", delta: "", reason: "" });

  const load = useCallback(async () => {
    const q = new URLSearchParams();
    if (companyId) q.set("companyId", companyId);
    if (storeId) q.set("storeId", storeId);
    q.set("hours", String(hours));
    const r = await api(`/api/v1/owner/ops/review?${q.toString()}`);
    if (r.ok) {
      setReview(r.data as unknown as Review);
      setLoadErr(false);
    } else setLoadErr(true);
  }, [companyId, storeId, hours]);
  useEffect(() => {
    load();
    const t = setInterval(load, 30000); // 30초마다 새로 고침
    return () => clearInterval(t);
  }, [load]);

  const searchCustomer = useCallback(async (p: string) => {
    const digits = p.replace(/[^0-9]/g, "");
    if (digits.length < 9) {
      setCustMsg("전화번호를 입력해 주세요.");
      return;
    }
    setPhone(digits);
    setCustMsg(null);
    const r = await api(`/api/v1/owner/ops/customer?phone=${digits}`);
    if (r.ok) {
      setCust(r.data as unknown as Customer);
      setAdj({ accountId: "", delta: "", reason: "" });
    } else {
      setCust(null);
      setCustMsg(errText(r.data));
    }
  }, []);

  async function act(body: Record<string, unknown>, confirmText: string, after?: () => void | Promise<void>) {
    if (!window.confirm(confirmText)) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await api("/api/v1/owner/ops/actions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      setMsg(r.ok ? "처리했습니다." : errText(r.data));
      if (r.ok) {
        await load();
        if (after) await after();
      }
    } finally {
      setBusy(false);
    }
  }

  async function toggleSwitch(name: "autoInjectAllowed" | "redeemPaused", value: boolean) {
    const text =
      name === "redeemPaused"
        ? value
          ? "포인트 사용을 일시 중지합니다.\n\n모든 포스기에서 사용 조회가 거부되어 통합포인트가 표시·사용되지 않습니다(적립과 이미 끝난 결제의 반영은 계속됩니다). 문제를 점검하는 동안만 켜세요. 중지할까요?"
          : "포인트 사용 일시 중지를 해제합니다. 해제할까요?"
        : value
          ? "고객 조회 시 통합포인트 자동 반영을 다시 허용합니다(포스기별 체크가 켜진 곳만 동작). 허용할까요?"
          : "고객 조회 시 통합포인트 자동 반영을 모든 포스기에서 멈춥니다(최대 30초 안에 적용). 멈출까요?";
    if (!window.confirm(text)) return;
    setBusy(true);
    try {
      const r = await api("/api/v1/owner/ops/switches", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, value }) });
      setMsg(r.ok ? "적용했습니다(포스기에는 30초 안에 전달됩니다)." : "변경하지 못했습니다.");
      await load();
    } finally {
      setBusy(false);
    }
  }

  // 한 포스기가 서버로 이전한 초기 포인트를 모두 되돌린다(잘못 이전했을 때) — 대상 건수·금액을 먼저 보여 주고 사유를 받는다.
  async function reverseImports(t: TerminalRow) {
    setBusy(true);
    setMsg(null);
    try {
      const pv = await api("/api/v1/owner/ops/actions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "preview-terminal-imports", terminalId: t._id }) });
      if (!pv.ok) {
        setMsg(errText(pv.data));
        return;
      }
      const count = Number(pv.data.count ?? 0);
      const total = Number(pv.data.totalAmount ?? 0);
      if (count === 0) {
        setMsg("이 포스기에서 이전한 초기 포인트 중 되돌릴 내역이 없습니다.");
        return;
      }
      const reason = window.prompt(`${t.storeName} ${t.name}이(가) 서버로 이전한 초기 포인트 ${count}건(합계 ${won(total)})을 모두 되돌립니다.\n서버 잔액에서 그만큼 차감되며 포스의 잔액은 바뀌지 않습니다(포스는 바탕화면 백업 파일로 복원).\n\n사유를 입력해 주세요.`);
      if (!reason) return;
      if (!window.confirm(`정말 ${count}건(${won(total)})을 되돌릴까요? 되돌린 뒤에는 이 포스기의 초기 이전을 다시 해야 합니다.`)) return;
      const r = await api("/api/v1/owner/ops/actions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "reverse-terminal-imports", terminalId: t._id, reason }) });
      setMsg(r.ok ? `처리했습니다. ${r.data.done}건(${won(Number(r.data.totalAmount ?? 0))}) 되돌림${Number(r.data.failed) > 0 ? `, 실패 ${r.data.failed}건(감사로그 확인)` : ""}.` : errText(r.data));
      await load();
    } finally {
      setBusy(false);
    }
  }

  const stores = (review?.options.stores ?? []).filter((s) => !companyId || s.companyId === companyId);
  const exportQ = companyId ? `&companyId=${companyId}` : "";

  return (
    <div>
      <div className="page-header">
        <div className="eyebrow">본사 관리모드</div>
        <h1>운영 점검·복구</h1>
        <div className="desc">
          포스기 상태와 확인이 필요한 항목을 한눈에 보고, 문제가 생기면 이 화면에서 정정합니다. 원장은 지우지 않고 반대 내역을 추가하며, 모든 조치는 사유와 함께 감사로그에 남습니다.
          30초마다 자동으로 새로 고쳐집니다.
        </div>
      </div>

      <div className="card" style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
        <select style={{ width: "auto", minWidth: 180 }} value={companyId} onChange={(e) => { setCompanyId(e.target.value); setStoreId(""); }}>
          <option value="">전체 고객사</option>
          {(review?.options.companies ?? []).map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
        </select>
        <select style={{ width: "auto", minWidth: 180 }} value={storeId} onChange={(e) => setStoreId(e.target.value)}>
          <option value="">전체 매장</option>
          {stores.map((s) => <option key={s._id} value={s._id}>{s.name}</option>)}
        </select>
        <select style={{ width: "auto" }} value={hours} onChange={(e) => setHours(Number(e.target.value))}>
          <option value={6}>최근 6시간</option>
          <option value={24}>최근 24시간</option>
          <option value={72}>최근 3일</option>
          <option value={168}>최근 7일</option>
        </select>
        <button type="button" className="ghost" onClick={load}>새로 고침</button>
        <span className="faint">{review ? `${fmt(review.generatedAt)} 기준` : loadErr ? "불러오지 못했습니다" : "불러오는 중..."}</span>
      </div>
      {msg && <p className={msg.startsWith("처리했습니다") || msg.startsWith("적용했습니다") ? "muted" : "error"} style={{ margin: "8px 4px" }}>{msg}</p>}

      {review && (
        <>
          <div className="stat-grid" style={{ marginTop: 12 }}>
            <div className={"stat-tile" + (review.summary.critical > 0 ? " accent" : "")}>
              <div className="stat-label">바로 확인할 항목</div>
              <div className="stat-value">{review.summary.critical}</div>
              <div className="stat-sub">보류·마이너스·잔액 부족·오래 남은 반영</div>
            </div>
            <div className="stat-tile">
              <div className="stat-label">주의 항목</div>
              <div className="stat-value">{review.summary.warn}</div>
              <div className="stat-sub">포스기 상태 문제 + 서버 거부/보류</div>
            </div>
            <div className="stat-tile">
              <div className="stat-label">포스기 연결</div>
              <div className="stat-value">{review.summary.online}/{review.summary.terminals}</div>
              <div className="stat-sub">대 (3분 안에 연결)</div>
            </div>
            <div className="stat-tile">
              <div className="stat-label">오프라인 후 반영</div>
              <div className="stat-value">{review.summary.offlineDelayedEvents}</div>
              <div className="stat-sub">건 (최근 {review.hours}시간)</div>
            </div>
          </div>

          <div className="card" style={{ marginTop: 12 }}>
            <h3 style={{ marginTop: 0 }}>긴급 스위치</h3>
            <div className="row" style={{ marginBottom: 10 }}>
              <span>
                <span className="value">고객 조회 시 통합포인트 자동 반영</span>
                <div className="faint" style={{ marginTop: 4 }}>끄면 모든 포스기가 자동 반영을 멈춥니다(트레이의 개별 체크와 별개). 문제가 의심될 때 먼저 끄세요.</div>
              </span>
              <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span className={"badge " + (review.switches.autoInjectAllowed ? "success" : "danger")}>{review.switches.autoInjectAllowed ? "허용" : "중지됨"}</span>
                <button type="button" className={review.switches.autoInjectAllowed ? "" : "ghost"} disabled={busy} onClick={() => toggleSwitch("autoInjectAllowed", !review.switches.autoInjectAllowed)}>
                  {review.switches.autoInjectAllowed ? "멈추기" : "다시 허용"}
                </button>
              </span>
            </div>
            <div className="row">
              <span>
                <span className="value">포인트 사용 일시 중지</span>
                <div className="faint" style={{ marginTop: 4 }}>켜면 모든 포스기의 사용 조회가 거부됩니다(적립은 계속). 정정 작업 중 이중 사용을 막을 때 쓰세요.</div>
              </span>
              <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span className={"badge " + (review.switches.redeemPaused ? "danger" : "success")}>{review.switches.redeemPaused ? "중지 중" : "사용 가능"}</span>
                <button type="button" className={review.switches.redeemPaused ? "" : "ghost"} disabled={busy} onClick={() => toggleSwitch("redeemPaused", !review.switches.redeemPaused)}>
                  {review.switches.redeemPaused ? "중지 해제" : "사용 중지"}
                </button>
              </span>
            </div>
          </div>

          <Section title="포스 포인트 이전 보류 — 확인 후 처리" count={review.issues.importHolds.length} empty="보류된 이전이 없습니다.">
            <p className="faint">같은 매장의 다른 포스기와 잔액이 거의 같으면 포스기들의 DB가 서로 복제된 것일 수 있어 자동으로 더하지 않았습니다. 같은 포인트의 복제면 &quot;더하지 않음&quot;, 포스기마다 따로 쌓인 포인트가 맞다면 &quot;서버에 더함&quot;을 누르세요. 어느 쪽이든 포스 잔액은 프로그램이 0으로 정리합니다.</p>
            <table>
              <thead><tr><th>매장 / 포스기</th><th>고객</th><th>사유</th><th>포스 잔액</th><th>더해질 금액</th><th>기준</th><th></th></tr></thead>
              <tbody>
                {review.issues.importHolds.map((h) => (
                  <tr key={h._id}>
                    <td>{h.storeName}<div className="faint">{h.terminalName}</div></td>
                    <td><button type="button" className="link" onClick={() => searchCustomer(h.phone)}>{h.phone}</button><div className="faint">{h.customerName}</div></td>
                    <td>{HOLD_KIND[h.kind] ?? h.kind}</td>
                    <td>{won(h.balance)}</td>
                    <td>{won(h.amount)}</td>
                    <td>{won(h.previous)}</td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      <button type="button" disabled={busy} onClick={() => act({ action: "resolve-hold", holdId: h._id, decision: "approve" }, `${h.phone}의 ${won(h.amount)}를 서버에 더합니다. 진행할까요?`)}>서버에 더함</button>{" "}
                      <button type="button" className="ghost" disabled={busy} onClick={() => act({ action: "resolve-hold", holdId: h._id, decision: "dismiss" }, `${h.phone}의 이번 포스 잔액은 더하지 않고 포스 잔액만 정리합니다(다른 포스기와 같은 포인트로 판단). 진행할까요?`)}>더하지 않음</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>

          <Section title="마이너스 잔액 계좌" count={review.issues.negativeAccounts.length} empty="마이너스 잔액이 없습니다.">
            <p className="faint">사용액이 잔액보다 많아 서버가 강제로 차감한 경우 등입니다. 고객을 조회해 내역을 확인하고, 원인이 중복·오류면 내역을 되돌리거나 보정하세요.</p>
            <table>
              <thead><tr><th>고객사 / 매장</th><th>고객</th><th>잔액</th></tr></thead>
              <tbody>
                {review.issues.negativeAccounts.map((a) => (
                  <tr key={a._id}>
                    <td>{a.companyName}<div className="faint">{a.storeName}</div></td>
                    <td><button type="button" className="link" onClick={() => searchCustomer(a.phone)}>{a.phone}</button><div className="faint">{a.customerName}</div></td>
                    <td className="danger-text">{won(a.balance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>

          <Section title="잔액이 모자라 마이너스로 차감된 결제" count={review.issues.shortfalls.length} empty="없습니다.">
            <table>
              <thead><tr><th>시각</th><th>매장 / 포스기</th><th>고객</th><th>사용액</th></tr></thead>
              <tbody>
                {review.issues.shortfalls.map((s) => (
                  <tr key={s._id}>
                    <td>{fmt(s.occurredAt)}</td>
                    <td>{s.storeName}<div className="faint">{s.terminalName}</div></td>
                    <td><button type="button" className="link" onClick={() => searchCustomer(s.phone)}>{s.phone}</button></td>
                    <td>{won(s.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>

          <Section title="반영한 값이 오래 되돌려지지 않은 건" count={review.issues.stuckSwaps.length} empty="없습니다.">
            <p className="faint">사용 조회로 포스 화면에 반영한 뒤 20분이 지나도록 &quot;되돌림&quot; 기록이 없는 건입니다. 포스가 꺼졌거나 오류일 수 있어 해당 포스를 확인하세요(다시 켜지면 프로그램이 이어서 정리합니다).</p>
            <table>
              <thead><tr><th>매장 / 포스기</th><th>고객</th><th>반영 금액</th><th>경과</th></tr></thead>
              <tbody>
                {review.issues.stuckSwaps.map((s, i) => (
                  <tr key={i}>
                    <td>{s.storeName}<div className="faint">{s.terminalName}</div></td>
                    <td><button type="button" className="link" onClick={() => searchCustomer(s.phone)}>{s.phone}</button></td>
                    <td>{won(s.amount)}</td>
                    <td>{s.minutesAgo}분 전</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>

          <Section title="서버가 거부했거나 보류한 포스 결제" count={review.issues.rejectedOrSkipped.length} empty="없습니다.">
            <table>
              <thead><tr><th>시각</th><th>구분</th><th>매장 / 포스기</th><th>고객</th><th>금액</th><th>사유</th></tr></thead>
              <tbody>
                {review.issues.rejectedOrSkipped.map((t) => (
                  <tr key={t._id}>
                    <td>{fmt(t.recordedAt)}</td>
                    <td><span className="badge danger">{KIND_LABEL[t.kind] ?? t.kind}</span></td>
                    <td>{t.storeName}<div className="faint">{t.terminalName}</div></td>
                    <td>{t.phone ? <button type="button" className="link" onClick={() => searchCustomer(t.phone)}>{t.phone}</button> : "-"}</td>
                    <td>{won(t.amount)}</td>
                    <td>{t.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>

          <Section title="걸려 있는 사용 조회 잠금" count={review.issues.locks.length} empty="걸려 있는 잠금이 없습니다.">
            <table>
              <thead><tr><th>고객</th><th>매장 / 포스기</th><th>경과</th><th></th></tr></thead>
              <tbody>
                {review.issues.locks.map((l) => (
                  <tr key={l.userId}>
                    <td><button type="button" className="link" onClick={() => searchCustomer(l.phone)}>{l.phone}</button></td>
                    <td>{l.storeName}<div className="faint">{l.terminalName}</div></td>
                    <td>{l.heldSec}초</td>
                    <td><button type="button" className="ghost" disabled={busy} onClick={() => act({ action: "release-locks", userId: l.userId }, `${l.phone}의 사용 조회 잠금을 풉니다. 진행할까요?`)}>잠금 풀기</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>

          <div className="card" style={{ marginTop: 12 }}>
            <h3 style={{ marginTop: 0 }}>포스기 상태 ({review.terminals.length}대){review.expectedVersion ? <span className="faint" style={{ fontWeight: 400 }}> · 최신 버전 {review.expectedVersion}</span> : null}</h3>
            <table>
              <thead><tr><th>고객사 / 매장 / 포스기</th><th>연결</th><th>버전</th><th>자동 반영</th><th>미전송</th><th>확인 사항</th><th></th></tr></thead>
              <tbody>
                {review.terminals.map((t) => (
                  <tr key={t._id}>
                    <td>{t.companyName} › {t.storeName}<div className="value">{t.name}</div></td>
                    <td><span className={"badge " + (t.online ? "success" : "danger")}>{t.online ? "연결" : "끊김"}</span><div className="faint">{fmt(t.lastSeenAt)}</div></td>
                    <td>{t.agentVersion ?? "-"}{t.agentVersion && !t.isLatest ? <div className="faint">구버전</div> : null}</td>
                    <td>{t.autoInject === null ? "-" : t.autoInject ? <span className="badge gold">켬{t.swapPending ? ` (반영 중 ${t.swapPending})` : ""}</span> : <span className="badge neutral">끔</span>}</td>
                    <td>{t.pending}</td>
                    <td>{t.flags.length === 0 ? <span className="faint">정상</span> : t.flags.map((f, i) => <div key={i} className={f.level === "critical" ? "error" : "faint"}>{f.text}</div>)}</td>
                    <td><button type="button" className="ghost" disabled={busy} onClick={() => reverseImports(t)}>초기 이전 되돌리기</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="card" style={{ marginTop: 12 }}>
            <h3 style={{ marginTop: 0 }}>최근 {review.hours}시간 내역 요약</h3>
            <table>
              <thead><tr><th>종류</th><th>건수</th><th>금액 합계</th></tr></thead>
              <tbody>
                {review.summary.events.map((e) => <tr key={e.type}><td>{TYPE_LABEL[e.type] ?? e.type}</td><td>{e.count.toLocaleString()}</td><td>{won(e.amount)}</td></tr>)}
                {review.summary.events.length === 0 && <tr><td colSpan={3} className="faint">내역이 없습니다.</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}

      <div className="card" style={{ marginTop: 12 }}>
        <h3 style={{ marginTop: 0 }}>고객 조사·조치</h3>
        <form onSubmit={(e) => { e.preventDefault(); searchCustomer(phone); }} style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input style={{ width: 240 }} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="고객 전화번호" inputMode="numeric" />
          <button type="submit">조회</button>
        </form>
        {custMsg && <p className="error">{custMsg}</p>}
        {cust && (
          <div style={{ marginTop: 12 }}>
            <p><span className="value">{cust.user.name || "(이름 없음)"}</span> · {cust.user.phone}</p>
            {cust.lock && (
              <p className="error">
                사용 조회 잠금: {cust.lock.storeName} / {cust.lock.terminalName} ({fmt(cust.lock.lockedAt)}){" "}
                <button type="button" className="ghost" disabled={busy} onClick={() => act({ action: "release-locks", userId: cust.user._id }, "이 고객의 사용 조회 잠금을 풉니다. 진행할까요?", () => searchCustomer(cust.user.phone))}>잠금 풀기</button>
              </p>
            )}
            <h4>계좌</h4>
            <table>
              <thead><tr><th>고객사</th><th>구분 / 매장</th><th>잔액</th></tr></thead>
              <tbody>
                {cust.accounts.map((a) => <tr key={a._id}><td>{a.companyName}</td><td>{a.storeName}</td><td className={a.balance < 0 ? "danger-text" : ""}>{won(a.balance)}</td></tr>)}
                {cust.accounts.length === 0 && <tr><td colSpan={3} className="faint">계좌가 없습니다.</td></tr>}
              </tbody>
            </table>

            <h4>잔액 보정</h4>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
              <select style={{ width: "auto", minWidth: 240 }} value={adj.accountId} onChange={(e) => setAdj({ ...adj, accountId: e.target.value })}>
                <option value="">보정할 계좌 선택</option>
                {cust.accounts.map((a) => <option key={a._id} value={a._id}>{a.companyName} · {a.storeName} ({won(a.balance)})</option>)}
              </select>
              <input value={adj.delta} onChange={(e) => setAdj({ ...adj, delta: e.target.value })} placeholder="증감 금액 (예: -1500)" inputMode="numeric" style={{ width: 170 }} />
              <input value={adj.reason} onChange={(e) => setAdj({ ...adj, reason: e.target.value })} placeholder="사유(필수)" style={{ width: 260 }} />
              <button
                type="button"
                disabled={busy || !adj.accountId || !adj.delta || !adj.reason}
                onClick={() => {
                  const a = cust.accounts.find((x) => x._id === adj.accountId);
                  if (!a) return;
                  act({ action: "correct-balance", userId: cust.user._id, companyId: a.companyId, storeId: a.storeId, delta: Number(adj.delta), reason: adj.reason }, `${a.companyName} · ${a.storeName} 잔액 ${won(a.balance)}에 ${adj.delta}P를 더합니다(결과 ${won(a.balance + Number(adj.delta))}). 사유: ${adj.reason}\n진행할까요?`, () => searchCustomer(cust.user.phone));
                }}
              >보정</button>
            </div>

            <h4>최근 내역 (되돌리기)</h4>
            <table>
              <thead><tr><th>시각</th><th>종류</th><th>금액</th><th>매장 / 포스기</th><th>사유</th><th></th></tr></thead>
              <tbody>
                {cust.events.map((e) => (
                  <tr key={e._id} style={e.reversedBy || e.reversalOf ? { opacity: 0.6 } : undefined}>
                    <td>{fmt(e.occurredAt)}{e.offline && <div className="faint">오프라인 후 반영</div>}</td>
                    <td>{TYPE_LABEL[e.type] ?? e.type}{e.reversedBy ? <div className="faint">되돌려짐</div> : null}{e.reversalOf ? <div className="faint">되돌리기 내역</div> : null}</td>
                    <td>{won(e.amount)}</td>
                    <td>{e.storeName}<div className="faint">{e.terminalName ?? ""}</div></td>
                    <td className="faint">{e.reason}</td>
                    <td>
                      {!e.reversedBy && !e.reversalOf && e.type !== "TRANSFER_IN" && e.type !== "TRANSFER_OUT" && (
                        <button
                          type="button"
                          className="ghost"
                          disabled={busy}
                          onClick={() => {
                            const reason = window.prompt(`이 내역(${TYPE_LABEL[e.type] ?? e.type} ${won(e.amount)})을 되돌립니다. 사유를 입력해 주세요.`);
                            if (!reason) return;
                            act({ action: "reverse-event", eventId: e._id, reason }, `${TYPE_LABEL[e.type] ?? e.type} ${won(e.amount)} 내역을 되돌립니다(반대 내역이 추가되고 잔액이 바뀝니다). 사유: ${reason}\n진행할까요?`, () => searchCustomer(cust.user.phone));
                          }}
                        >되돌리기</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <h4>포스 ↔ 서버 이동 기록</h4>
            <table>
              <thead><tr><th>시각</th><th>구분</th><th>금액</th><th>매장 / 포스기</th><th>포스 전→후</th><th>서버 잔액</th><th>비고</th></tr></thead>
              <tbody>
                {cust.transfers.map((t) => (
                  <tr key={t._id}>
                    <td>{fmt(t.recordedAt)}</td>
                    <td>{KIND_LABEL[t.kind] ?? t.kind}</td>
                    <td>{won(t.amount)}</td>
                    <td>{t.storeName}<div className="faint">{t.terminalName}</div></td>
                    <td>{t.localBefore ?? "-"} → {t.localAfter ?? "-"}</td>
                    <td>{t.serverBalanceAfter ?? "-"}</td>
                    <td className="faint">{t.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {cust.holds.length > 0 && (
              <>
                <h4>이전 보류 기록</h4>
                <table>
                  <thead><tr><th>시각</th><th>사유</th><th>매장 / 포스기</th><th>포스 잔액</th><th>더해질 금액</th><th>상태</th></tr></thead>
                  <tbody>
                    {cust.holds.map((h) => <tr key={h._id}><td>{fmt(h.createdAt)}</td><td>{HOLD_KIND[h.kind] ?? h.kind}</td><td>{h.storeName}<div className="faint">{h.terminalName}</div></td><td>{won(h.balance)}</td><td>{won(h.amount)}</td><td>{h.status === "OPEN" ? "확인 필요" : h.status === "APPROVED" ? "서버에 더함" : "더하지 않음"}</td></tr>)}
                  </tbody>
                </table>
              </>
            )}
          </div>
        )}
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <h3 style={{ marginTop: 0 }}>원장 내보내기 (백업·대조용 CSV)</h3>
        <p className="faint">도입 전·정정 전후로 받아 두면 잔액을 비교할 수 있습니다. 위에서 고객사를 고르면 그 고객사만, 고르지 않으면 전체입니다.</p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <a className="button" href={`/api/v1/owner/ops/export?kind=accounts${exportQ}`}>계좌별 잔액</a>
          <a className="button ghost" href={`/api/v1/owner/ops/export?kind=events&days=7${exportQ}`}>최근 7일 내역</a>
          <a className="button ghost" href={`/api/v1/owner/ops/export?kind=events&days=30${exportQ}`}>최근 30일 내역</a>
        </div>
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <h3 style={{ marginTop: 0 }}>상황별 대응</h3>
        <ul style={{ lineHeight: 1.8, paddingLeft: 18 }}>
          <li><b>통합포인트가 이상하게 많아 보임</b> → 먼저 &quot;긴급 스위치&quot;로 포인트 사용을 중지하고, 위 &quot;이전 보류&quot;·고객 조사에서 같은 포인트가 포스기마다 중복 이전됐는지 확인합니다. 중복이면 초기 이전 내역을 &quot;되돌리기&quot;.</li>
          <li><b>챔프에서 사용했는데 서버가 안 줄어듦</b> → 해당 포스기의 &quot;미전송&quot;·최근 오류를 보고, 고객 조사의 이동 기록에서 사용(USE) 반영 여부를 확인합니다. 포스가 인터넷에 다시 연결되면 자동 반영됩니다.</li>
          <li><b>잔액이 모자라 마이너스가 됨</b> → 챔프에서 확정된 결제라 되돌릴 수 없습니다. 원인(동시 사용, 중복 이전 등)을 확인하고 필요하면 보정합니다.</li>
          <li><b>포스가 꺼져 값이 남음</b> → 포스를 다시 켜면 프로그램이 이어서 정리합니다. 급하면 &quot;잠금 풀기&quot;와 포스 프로그램의 &quot;포인트 서버로 이전&quot;(남은 포인트 정리)을 사용합니다.</li>
          <li><b>자동 반영이 오작동</b> → &quot;긴급 스위치&quot;에서 자동 반영을 멈추면 팝업 방식으로 돌아갑니다.</li>
          <li><b>복원이 필요한 큰 문제</b> → 원장 CSV를 받아 두고, 움막AI에게 DB 백업(mongodump) 복원을 요청합니다(docs/OPS-RUNBOOK.md 참고).</li>
        </ul>
      </div>
    </div>
  );
}

function Section({ title, count, empty, children }: { title: string; count: number; empty: string; children: React.ReactNode }) {
  return (
    <div className="card" style={{ marginTop: 12 }}>
      <h3 style={{ marginTop: 0 }}>
        {title} <span className={"badge " + (count > 0 ? "danger" : "success")}>{count}</span>
      </h3>
      {count === 0 ? <p className="faint">{empty}</p> : children}
    </div>
  );
}
