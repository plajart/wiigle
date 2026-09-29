"use client";

import { useEffect, useState } from "react";

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
};

export default function HistoryClient() {
  const [history, setHistory] = useState<HistoryItem[] | null>(null);

  useEffect(() => {
    fetch("/api/v1/me/points/history")
      .then((r) => r.json())
      .then((d) => setHistory(d.history ?? []));
  }, []);

  return (
    <div>
      <div className="page-header">
        <div className="eyebrow">내 포인트</div>
        <h1>이용 내역</h1>
      </div>

      <div className="card">
        {history === null && <p className="muted">불러오는 중...</p>}
        {history?.length === 0 && (
          <div className="empty-state">
            <div className="ic">≡</div>
            아직 포인트 이용 내역이 없습니다
          </div>
        )}
        {history?.map((h) => {
          const positive = h.amount >= 0;
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
                {h.amount.toLocaleString()}P
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
