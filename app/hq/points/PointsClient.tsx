"use client";

import { useState } from "react";

export default function PointsClient() {
  const [grantPhone, setGrantPhone] = useState("");
  const [grantAmount, setGrantAmount] = useState("");
  const [grantReason, setGrantReason] = useState("");
  const [grantMsg, setGrantMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [grantBusy, setGrantBusy] = useState(false);

  const [adjustPhone, setAdjustPhone] = useState("");
  const [adjustDelta, setAdjustDelta] = useState("");
  const [adjustReason, setAdjustReason] = useState("");
  const [adjustMsg, setAdjustMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [adjustBusy, setAdjustBusy] = useState(false);

  async function grant(e: React.FormEvent) {
    e.preventDefault();
    setGrantMsg(null);
    setGrantBusy(true);
    try {
      const res = await fetch("/api/v1/hq/points/grant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerPhone: grantPhone, amount: Number(grantAmount), reason: grantReason }),
      });
      const data = await res.json();
      setGrantMsg(res.ok ? { text: "포인트가 발급되었습니다.", ok: true } : { text: `실패: ${data.error}`, ok: false });
      if (res.ok) {
        setGrantAmount("");
        setGrantReason("");
      }
    } finally {
      setGrantBusy(false);
    }
  }

  async function adjust(e: React.FormEvent) {
    e.preventDefault();
    setAdjustMsg(null);
    setAdjustBusy(true);
    try {
      const res = await fetch("/api/v1/hq/points/adjust", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerPhone: adjustPhone, delta: Number(adjustDelta), reason: adjustReason }),
      });
      const data = await res.json();
      setAdjustMsg(res.ok ? { text: "조정이 반영되었습니다.", ok: true } : { text: `실패: ${data.error}`, ok: false });
      if (res.ok) {
        setAdjustDelta("");
        setAdjustReason("");
      }
    } finally {
      setAdjustBusy(false);
    }
  }

  return (
    <div>
      <div className="page-header">
        <div className="eyebrow">플랫폼 관리자</div>
        <h1>포인트 관리</h1>
      </div>

      <h2>본사 포인트 발급</h2>
      <div className="card">
        <form onSubmit={grant}>
          <div className="field">
            <label>고객 휴대폰번호</label>
            <input value={grantPhone} onChange={(e) => setGrantPhone(e.target.value)} placeholder="01012345678" required />
          </div>
          <div className="field">
            <label>발급 금액</label>
            <input type="number" min={1} value={grantAmount} onChange={(e) => setGrantAmount(e.target.value)} required />
          </div>
          <div className="field">
            <label>사유 (선택)</label>
            <input value={grantReason} onChange={(e) => setGrantReason(e.target.value)} placeholder="예: 이벤트 지급" />
          </div>
          {grantMsg && <p className={grantMsg.ok ? "success-msg" : "error"}>{grantMsg.text}</p>}
          <button type="submit" className="full gold" disabled={grantBusy}>
            {grantBusy ? "처리 중..." : "포인트 발급"}
          </button>
        </form>
      </div>

      <h2>본사 포인트 조정 / 회수</h2>
      <div className="card">
        <form onSubmit={adjust}>
          <div className="field">
            <label>고객 휴대폰번호</label>
            <input value={adjustPhone} onChange={(e) => setAdjustPhone(e.target.value)} placeholder="01012345678" required />
          </div>
          <div className="field">
            <label>증감액 (회수는 음수로 입력)</label>
            <input type="number" value={adjustDelta} onChange={(e) => setAdjustDelta(e.target.value)} placeholder="-1000" required />
          </div>
          <div className="field">
            <label>사유</label>
            <input value={adjustReason} onChange={(e) => setAdjustReason(e.target.value)} placeholder="예: 오적립 회수" />
          </div>
          {adjustMsg && <p className={adjustMsg.ok ? "success-msg" : "error"}>{adjustMsg.text}</p>}
          <button type="submit" className="full secondary" disabled={adjustBusy}>
            {adjustBusy ? "처리 중..." : "조정 적용"}
          </button>
        </form>
      </div>
    </div>
  );
}
