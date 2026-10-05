"use client";

import { useEffect, useState, useCallback } from "react";

type Detail = {
  _id: string;
  type: string;
  amount: number;
  occurredAt: string;
  terminalId: string | null;
  terminalName: string;
  cardNo: string | null;
  reason: string | null;
};
type ByTerminal = { terminalId: string; name: string; earned: number; used: number; count: number };
type Settlement = { date: string; totalEarned: number; totalUsed: number; count: number; byTerminal: ByTerminal[]; detail: Detail[] };

const EARN_TYPES = new Set(["EARN", "VENDOR_EARN", "VENDOR_IMPORT", "GRANT", "ADJUST"]);
const CANCEL_LABEL: Record<string, string> = { EARN_CANCEL: "적립 취소", USE_CANCEL: "사용 취소" };

function todayKst(): string {
  // 서버가 KST 기준으로 하루를 자르므로, 날짜 선택 기본값도 KST 오늘로 맞춘다.
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

export default function SettlementClient({ storeId }: { storeId: string }) {
  const [date, setDate] = useState(todayKst());
  const [data, setData] = useState<Settlement | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (d: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/v1/stores/${storeId}/settlement?date=${d}`);
      const json = await res.json();
      setData(res.ok ? json : null);
    } finally {
      setLoading(false);
    }
  }, [storeId]);

  useEffect(() => {
    load(date);
  }, [date, load]);

  return (
    <div>
      <div className="page-header">
        <div className="eyebrow">매장 관리자</div>
        <h1>일일 정산</h1>
        <div className="desc">매장 안의 모든 POS 단말을 합친 그날의 적립·사용 내역입니다. 달력에서 날짜를 골라 지난 정산도 볼 수 있습니다.</div>
      </div>

      <div className="card" style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
        <label htmlFor="settlement-date" className="muted">정산 날짜</label>
        <input
          id="settlement-date"
          type="date"
          value={date}
          max={todayKst()}
          onChange={(e) => setDate(e.target.value)}
          style={{ maxWidth: 200 }}
        />
        {loading && <span className="muted">불러오는 중...</span>}
      </div>

      {data && (
        <>
          <div className="stat-grid" style={{ marginBottom: 20 }}>
            <div className="stat-tile">
              <div className="stat-label">총 적립</div>
              <div className="stat-value">{data.totalEarned.toLocaleString()}원</div>
            </div>
            <div className="stat-tile">
              <div className="stat-label">총 사용</div>
              <div className="stat-value">{data.totalUsed.toLocaleString()}원</div>
            </div>
            <div className="stat-tile">
              <div className="stat-label">거래 건수</div>
              <div className="stat-value">{data.count.toLocaleString()}건</div>
            </div>
          </div>

          <h2>단말별 소계</h2>
          <div className="card" style={{ marginBottom: 20 }}>
            {data.byTerminal.length === 0 && <div className="empty-state">이 날짜엔 거래가 없습니다</div>}
            {data.byTerminal.map((t) => (
              <div className="row" key={t.terminalId}>
                <span className="value">{t.name}</span>
                <span className="faint">
                  적립 {t.earned.toLocaleString()}원 · 사용 {t.used.toLocaleString()}원 · {t.count}건
                </span>
              </div>
            ))}
          </div>

          <h2>상세 내역</h2>
          <div className="card">
            {data.detail.length === 0 && <div className="empty-state">내역이 없습니다</div>}
            {data.detail.map((d) => (
              <div className="row" key={d._id}>
                <span>
                  <span className={"badge " + (EARN_TYPES.has(d.type) ? "success" : "neutral")}>
                    {CANCEL_LABEL[d.type] ?? (EARN_TYPES.has(d.type) ? "적립" : "사용")}
                  </span>{" "}
                  <span className="value">{d.amount.toLocaleString()}원</span>
                  <div className="faint" style={{ marginTop: 4 }}>
                    {new Date(d.occurredAt).toLocaleTimeString("ko-KR")} · {d.terminalName}
                    {d.cardNo ? ` · 카드 ${d.cardNo}` : ""}
                  </div>
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
