"use client";

import { useEffect, useState, useCallback } from "react";
import TerminalList from "./TerminalList";
import { useRealtime } from "../components/useRealtime";

type Summary = { customerCount: number; totalBalance: number };
type Ev = {
  _id: string;
  type: string;
  amount: number;
  occurredAt: string;
  recordedAt: string | null;
  offline: boolean;
  terminalName: string | null;
  customer: { name: string; phone: string } | null;
  cardNo: string | null;
};
type Tr = {
  _id: string;
  kind: string;
  amount: number;
  localBefore: number | null;
  localAfter: number | null;
  serverBalanceAfter: number | null;
  occurredAt: string;
  recordedAt: string;
  delaySec: number | null;
  offline: boolean;
  note: string | null;
  terminalName: string | null;
  customer: { name: string; phone: string } | null;
};

const EV_LABEL: Record<string, string> = {
  EARN: "적립", VENDOR_EARN: "적립", VENDOR_USE: "사용", REDEEM: "사용", VENDOR_IMPORT: "초기 이전",
  GRANT: "지급", ADJUST: "조정", TRANSFER_IN: "이체 입금", TRANSFER_OUT: "이체 출금", EARN_CANCEL: "적립 취소", USE_CANCEL: "사용 취소",
};
const EV_NEG = new Set(["VENDOR_USE", "REDEEM", "TRANSFER_OUT", "EARN_CANCEL"]);
const TR_LABEL: Record<string, string> = {
  LOOKUP_TO_POS: "서버→포스 (사용 조회)", RESTORE_POS: "포스 잔액 복원(0)", EARN_TO_SERVER: "포스→서버 (적립 이전)", USE_TO_SERVER: "포스→서버 (사용 반영)",
  EARN_CANCEL: "적립 취소 반영", USE_CANCEL: "사용 취소 반영", BULK_IMPORT: "초기 일괄 이전", SKIPPED: "보류(건너뜀)", REJECTED: "서버 거부(건너뜀)",
};

const fmt = (s: string) => new Date(s).toLocaleString("ko-KR");

export default function StoreDashboardClient({ storeId }: { storeId: string }) {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [events, setEvents] = useState<Ev[] | null>(null);
  const [transfers, setTransfers] = useState<Tr[] | null>(null);
  const [showTransfers, setShowTransfers] = useState(false);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    try {
      const [s, a] = await Promise.all([
        fetch(`/api/v1/stores/${storeId}/points/summary`).then((r) => (r.ok ? r.json() : null)),
        fetch(`/api/v1/stores/${storeId}/recent-activity`).then((r) => (r.ok ? r.json() : null)),
      ]);
      if (s && typeof s.customerCount === "number") setSummary(s);
      if (a) {
        setEvents(Array.isArray(a.events) ? a.events : []);
        setTransfers(Array.isArray(a.transfers) ? a.transfers : []);
      }
      setError(!s && !a);
    } catch {
      setError(true);
    }
  }, [storeId]);

  useEffect(() => {
    load();
  }, [load]);
  useRealtime(load); // 포인트가 적립·사용되면 새로고침 없이 바로 반영

  return (
    <div>
      <div className="page-header">
        <div className="eyebrow">매장 관리자</div>
        <h1>대시보드</h1>
      </div>

      {error && <p className="error">불러오지 못했습니다. 잠시 후 자동으로 다시 시도합니다.</p>}
      {!summary && !error && <p className="muted">불러오는 중...</p>}

      {summary && (
        <>
          <div className="stat-grid">
            <div className="stat-tile">
              <div className="stat-label">포인트 보유 고객 수</div>
              <div className="stat-value">{summary.customerCount.toLocaleString()}</div>
              <div className="stat-sub">명</div>
            </div>
            <div className="stat-tile accent">
              <div className="stat-label">이 매장 적립 포인트 총 잔액</div>
              <div className="stat-value">{summary.totalBalance.toLocaleString()}</div>
              <div className="stat-sub">P</div>
            </div>
          </div>
          <p className="faint">위 수치는 포인트 관리 프로그램에 가입한 고객만 집계됩니다.</p>
        </>
      )}

      <h2>포스 단말기</h2>
      <TerminalList storeId={storeId} />

      <h2>최근 포인트 거래</h2>
      <div className="card">
        {events === null && <p className="muted">불러오는 중...</p>}
        {events?.length === 0 && <p className="faint" style={{ margin: 0 }}>아직 거래가 없습니다.</p>}
        {events?.map((e) => {
          const neg = EV_NEG.has(e.type);
          return (
            <div className="row" key={e._id}>
              <span>
                <span className={"badge " + (neg ? "neutral" : "success")}>{EV_LABEL[e.type] ?? e.type}</span>{" "}
                <span className="value">{neg ? "-" : "+"}{Math.abs(e.amount).toLocaleString()}P</span>
                {e.offline && <span className="badge" style={{ marginLeft: 6 }}>오프라인 후 반영</span>}
                <div className="faint" style={{ marginTop: 4 }}>
                  {fmt(e.occurredAt)} · {e.terminalName ?? "웹/관리모드"}
                  {e.customer ? ` · ${e.customer.name} (${e.customer.phone})` : ""}
                  {e.offline && e.recordedAt ? ` · 서버 기록 ${fmt(e.recordedAt)}` : ""}
                </div>
              </span>
            </div>
          );
        })}
      </div>

      <h2>
        포스기 ↔ 서버 포인트 이동 기록{" "}
        <button type="button" className="sm ghost" onClick={() => setShowTransfers((v) => !v)}>
          {showTransfers ? "접기" : "펼치기"}
        </button>
      </h2>
      {showTransfers && (
        <div className="card">
          {transfers?.length === 0 && <p className="faint" style={{ margin: 0 }}>기록이 없습니다.</p>}
          {transfers?.map((t) => (
            <div className="row" key={t._id}>
              <span>
                <span className="badge neutral">{TR_LABEL[t.kind] ?? t.kind}</span>{" "}
                <span className="value">{t.amount.toLocaleString()}P</span>
                {t.offline && <span className="badge" style={{ marginLeft: 6 }}>오프라인 후 반영</span>}
                <div className="faint" style={{ marginTop: 4 }}>
                  {fmt(t.occurredAt)} · {t.terminalName ?? "-"}
                  {t.customer ? ` · ${t.customer.name} (${t.customer.phone})` : ""}
                  {t.localBefore !== null || t.localAfter !== null ? ` · 포스 잔액 ${t.localBefore ?? "?"} → ${t.localAfter ?? "?"}` : ""}
                  {t.serverBalanceAfter !== null ? ` · 서버 가용 ${t.serverBalanceAfter.toLocaleString()}` : ""}
                  {t.offline ? ` · 서버 기록 ${fmt(t.recordedAt)}` : ""}
                  {t.note ? ` · ${t.note}` : ""}
                </div>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
