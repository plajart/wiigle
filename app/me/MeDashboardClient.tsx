"use client";

import { useEffect, useState } from "react";

type CompanySummary = {
  companyId: string;
  companyName: string;
  hq: number;
  stores: { storeId: string; storeName: string; balance: number }[];
  total: number;
};
type Summary = { companies: CompanySummary[] };
type CardInfo = { cardNo: string; qrDataUrl: string };

export default function MeDashboardClient() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [card, setCard] = useState<CardInfo | null>(null);
  const [showCard, setShowCard] = useState(false);

  useEffect(() => {
    fetch("/api/v1/me/points")
      .then((r) => r.json())
      .then(setSummary);
    fetch("/api/v1/me/card")
      .then((r) => r.json())
      .then(setCard);
  }, []);

  return (
    <div>
      <div className="page-header">
        <div className="eyebrow">내 포인트</div>
        <h1>포인트 현황</h1>
      </div>

      <div className="card">
        <div className="card-title">
          내 회원카드
          <button type="button" className="sm gold" onClick={() => setShowCard((v) => !v)}>
            {showCard ? "QR 닫기" : "QR 보여주기"}
          </button>
        </div>
        {!showCard && (
          <p className="faint" style={{ margin: 0 }}>
            매장 계산대에서 QR을 스캔하면 카드번호가 자동으로 입력됩니다. 처음 방문한 매장이라면 계산원에게 이 QR을 보여주세요.
          </p>
        )}
        {showCard && card && (
          <div style={{ textAlign: "center", padding: "8px 0" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={card.qrDataUrl} alt="내 회원카드 QR" width={220} height={220} style={{ borderRadius: 12 }} />
            <div className="faint" style={{ marginTop: 10, letterSpacing: "0.08em" }}>
              카드번호 {card.cardNo}
            </div>
          </div>
        )}
        {showCard && !card && <p className="muted">불러오는 중...</p>}
      </div>

      {!summary && <p className="muted">불러오는 중...</p>}

      {summary && summary.companies.length === 0 && (
        <div className="card">
          <div className="empty-state">
            <div className="ic">P</div>
            아직 적립된 포인트가 없습니다
          </div>
        </div>
      )}

      {/* 통합포인트는 고객사(본사)별로 따로 쌓이고 그 고객사의 매장들 안에서만 쓸 수 있으므로, 고객사별로 나눠서 보여준다. */}
      {summary?.companies.map((c) => (
        <div key={c.companyId}>
          <div className="point-hero">
            <div className="hero-label">{c.companyName || "고객사"} · 사용 가능한 통합포인트</div>
            <div className="hero-value">{c.total.toLocaleString()}P</div>
            <div className="hero-sub">{c.companyName || "이 고객사"}의 어느 매장에서든 바로 사용할 수 있는 포인트입니다</div>
          </div>
          <div className="card">
            <div className="row">
              <span className="label">통합포인트 지급분</span>
              <span className="value">{c.hq.toLocaleString()}P</span>
            </div>
            {c.stores.map((s) => (
              <div className="row" key={s.storeId}>
                <span className="label">{s.storeName} 적립</span>
                <span className="value">{s.balance.toLocaleString()}P</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
