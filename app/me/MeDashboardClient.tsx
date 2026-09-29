"use client";

import { useEffect, useState } from "react";

type Summary = { hq: number; stores: { storeId: string; storeName: string; balance: number }[]; total: number };
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

      {summary && (
        <>
          <div className="point-hero">
            <div className="hero-label">사용 가능한 포인트</div>
            <div className="hero-value">{summary.total.toLocaleString()}P</div>
            <div className="hero-sub">어느 매장에서든 통합해서 바로 사용할 수 있는 포인트입니다</div>
          </div>

          <h2>적립 출처별 내역</h2>
          <div className="card">
            <div className="row">
              <span className="label">본사 지급 포인트</span>
              <span className="value">{summary.hq.toLocaleString()}P</span>
            </div>
            {summary.stores.length === 0 && (
              <div className="row">
                <span className="label">매장 적립 포인트</span>
                <span className="value faint">보유 매장 없음</span>
              </div>
            )}
            {summary.stores.map((s) => (
              <div className="row" key={s.storeId}>
                <span className="label">{s.storeName}</span>
                <span className="value">{s.balance.toLocaleString()}P</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
