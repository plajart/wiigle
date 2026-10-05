"use client";

import { useRealtime } from "../../components/useRealtime";
import { useCallback, useEffect, useState } from "react";

type HistoryItem = {
  _id: string;
  type: string;
  amount: number;
  status: string;
  storeId?: { name?: string } | null;
  companyId?: { name?: string } | null;
  occurredAt: string;
};

const TYPE_LABEL: Record<string, string> = {
  EARN: "적립",
  REDEEM: "사용",
  TRANSFER_OUT: "이체 출금",
  TRANSFER_IN: "이체 입금",
  GRANT: "지급",
  ADJUST: "조정",
  VENDOR_IMPORT: "최초 등록 적립",
  VENDOR_EARN: "적립",
  VENDOR_USE: "사용",
  EARN_CANCEL: "적립 취소",
  USE_CANCEL: "사용 취소(환원)",
};

const TYPE_BADGE_CLASS: Record<string, string> = {
  EARN: "success",
  REDEEM: "danger",
  TRANSFER_OUT: "neutral",
  TRANSFER_IN: "gold",
  GRANT: "gold",
  ADJUST: "neutral",
  VENDOR_IMPORT: "gold",
  VENDOR_EARN: "success",
  VENDOR_USE: "danger",
  EARN_CANCEL: "danger",
  USE_CANCEL: "success",
};

// 사용·출금·적립취소는 금액이 양수로 저장돼 있어도 줄어든 포인트이므로 마이너스로 보여준다.
const DECREASE_TYPES = new Set(["REDEEM", "VENDOR_USE", "TRANSFER_OUT", "EARN_CANCEL"]);

export default function HistoryClient() {
  const [history, setHistory] = useState<HistoryItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch("/api/v1/me/points/history")
      .then(async (r) => {
        if (r.status === 401) {
          window.location.href = "/login";
          return;
        }
        const d = await r.json().catch(() => null);
        if (!r.ok || !d || !Array.isArray(d.history)) {
          setError("이용 내역을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.");
          return;
        }
        setHistory(d.history as HistoryItem[]);
      })
      .catch(() => setError("네트워크 연결을 확인해주세요."));
  }, []);

  useEffect(() => {
    load();
  }, [load]);
  useRealtime(load);

  return (
    <div>
      <div className="page-header">
        <div className="eyebrow">내 포인트</div>
        <h1>이용 내역</h1>
      </div>

      <div className="card">
        {error && <p className="error" style={{ margin: 0 }}>{error}</p>}
        {history === null && !error && <p className="muted">불러오는 중...</p>}
        {history?.length === 0 && (
          <div className="empty-state">
            <div className="ic">≡</div>
            아직 포인트 이용 내역이 없습니다
          </div>
        )}
        {history?.map((h) => {
          const shown = DECREASE_TYPES.has(h.type) ? -Math.abs(h.amount) : h.amount;
          const positive = shown >= 0;
          return (
            <div className="row" key={h._id}>
              <span>
                <span className={"badge " + (TYPE_BADGE_CLASS[h.type] ?? "neutral")}>
                  {TYPE_LABEL[h.type] ?? h.type}
                </span>
                <div className="faint" style={{ marginTop: 4 }}>
                  {new Date(h.occurredAt).toLocaleString("ko-KR")} · {h.companyId?.name ? `${h.companyId.name} · ` : ""}{h.storeId?.name ?? "통합포인트"}
                </div>
              </span>
              <span className="value" style={{ color: positive ? "var(--success)" : "var(--danger)" }}>
                {positive ? "+" : ""}
                {shown.toLocaleString()}P
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
