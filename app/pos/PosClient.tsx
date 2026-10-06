"use client";

import { useState } from "react";

type HqInfo = { customerId: string; name: string; myStoreBalance: number; total: number };
type CheckoutBreakdown = { source: string; amount: number };

export default function PosClient() {
  const [phone, setPhone] = useState("");
  const [hq, setHq] = useState<HqInfo | null>(null);
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ breakdown: CheckoutBreakdown[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  const [earnInput, setEarnInput] = useState("");
  const [earnError, setEarnError] = useState<string | null>(null);
  const [earnResult, setEarnResult] = useState<{ earnAmount: number } | null>(null);
  const [earnLoading, setEarnLoading] = useState(false);

  // 같은 요청이 새로고침/이중클릭/네트워크 재시도로 두 번 가도 서버가 한 번만 반영하도록
  // 하는 멱등키. "성공했을 때만" 다음 건을 위해 새로 발급하고, 실패하면 그대로 재사용해
  // (혹시 서버에는 실제로 반영됐는데 응답만 못 받은 경우) 재시도가 중복 반영을 안 만들게 한다.
  const [checkoutTxnId, setCheckoutTxnId] = useState(() => crypto.randomUUID());
  const [earnTxnId, setEarnTxnId] = useState(() => crypto.randomUUID());

  function resetResults() {
    setError(null);
    setResult(null);
    setHq(null);
    setEarnError(null);
    setEarnResult(null);
  }

  // 카드는 신원 증거로 쓰지 않는다(빌려 쓸 수 있음) — 조회는 전화번호로만 한다(2026-09-27 결정).
  async function lookupByPhone(e: React.FormEvent) {
    e.preventDefault();
    resetResults();
    setSearched(true);
    const res = await fetch(`/api/v1/pos/customers/${encodeURIComponent(phone)}`);
    const data = await res.json();
    if (!res.ok) {
      setError(errorMessage(data.error));
      return;
    }
    setHq(data.hq);
  }

  async function checkout(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setResult(null);
    setLoading(true);
    try {
      const res = await fetch("/api/v1/pos/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerPhone: phone, amount: Number(amount), clientTxnId: checkoutTxnId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(errorMessage(data.error));
        return;
      }
      setResult(data);
      setAmount("");
      setCheckoutTxnId(crypto.randomUUID()); // 성공했으니 다음 결제를 위한 새 멱등키 발급
    } finally {
      setLoading(false);
    }
  }

  async function earn(e: React.FormEvent) {
    e.preventDefault();
    setEarnError(null);
    setEarnResult(null);
    setEarnLoading(true);
    try {
      const res = await fetch("/api/v1/pos/earn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerPhone: phone, earnAmount: Number(earnInput), clientTxnId: earnTxnId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setEarnError(errorMessage(data.error));
        return;
      }
      setEarnResult(data);
      setEarnInput("");
      setEarnTxnId(crypto.randomUUID()); // 성공했으니 다음 적립을 위한 새 멱등키 발급
    } finally {
      setEarnLoading(false);
    }
  }

  function errorMessage(code: string) {
    if (code === "READ_BALANCE_NOT_CONSENTED" || code === "WRITE_REDEEM_NOT_CONSENTED" || code === "WRITE_EARN_NOT_CONSENTED") {
      return "이 매장은 아직 해당 POS 연동 동의가 되어있지 않습니다 — POS 연동 동의 화면에서 켜주세요.";
    }
    if (code === "CUSTOMER_NOT_FOUND") return "가입된 고객을 찾을 수 없는 번호입니다.";
    if (code === "REDEEM_IN_PROGRESS_ELSEWHERE") return "이 손님은 지금 다른 곳(포스기 또는 다른 처리)에서 포인트를 사용 중입니다. 잠시 후 다시 시도해주세요.";
    if (code === "NO_STORE_CONTEXT") return "매장 관리모드로 들어간 뒤에 처리할 수 있습니다.";
    if (code === "INSUFFICIENT_BALANCE") return "포인트 잔액이 부족합니다 (통합 잔액 기준).";
    return code ?? "오류가 발생했습니다.";
  }

  return (
    <div>
      <div className="page-header">
        <div className="eyebrow">매장 관리모드</div>
        <h1>POS 결제 터미널</h1>
        <div className="desc">
          카운터 단말에 프로그램을 설치했다면 적립·사용은 결제 중 자동으로 처리됩니다. 이 화면은 전화번호로 직접
          조회·적립·사용을 처리하는 수동 보조 도구입니다. 포인트 사용 시 확인된 금액은 카운터 단말(챔프)의 할인란에
          직접 입력해 결제를 진행하세요. 이 화면에서 처리한 적립·사용은 포스 프로그램에는 기록되지 않으므로, 같은 결제를 포스에서도 적립·사용하지 않았는지 확인하세요(이중 처리 방지).
        </div>
      </div>

      <div className="card">
        <form onSubmit={lookupByPhone}>
          <label>고객 휴대폰번호</label>
          <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="01012345678" required />
          <button type="submit" className="full">
            고객 조회
          </button>
        </form>
      </div>

      {error && <p className="error">{error}</p>}

      {searched && !error && hq && (
        <>
          <div className="card">
            <div className="card-title">
              {hq.name}
              <span className="badge gold">가입 고객</span>
            </div>
            <div className="row">
              <span className="label">이 매장 포인트</span>
              <span className="value">{hq.myStoreBalance.toLocaleString()}P</span>
            </div>
            <div className="row">
              <span className="label">총 사용 가능 포인트 (통합)</span>
              <span className="value" style={{ fontSize: 17, color: "var(--gold-text)" }}>
                {hq.total.toLocaleString()}P
              </span>
            </div>

            <form onSubmit={checkout} style={{ marginTop: 18 }}>
              <label>포인트 사용(할인) 금액</label>
              <input type="number" min={1} value={amount} onChange={(e) => setAmount(e.target.value)} required />
              <button type="submit" className="full gold" disabled={loading}>
                {loading ? "처리 중..." : "포인트 차감 확정"}
              </button>
            </form>
          </div>

          <div className="card">
            <div className="card-title">포인트 적립</div>
            <p className="faint" style={{ marginBottom: 12 }}>
              포스기 프로그램이 자동으로 적립하지 못한 경우에만 쓰는 보조 기능입니다. 적립할 포인트를 직접 입력하면 이 자리에서 바로 적립됩니다(적립 비율은 포스기 프로그램에서 관리합니다).
            </p>
            <form onSubmit={earn}>
              <label>적립할 포인트</label>
              <input type="number" min={1} value={earnInput} onChange={(e) => setEarnInput(e.target.value)} required />
              <button type="submit" className="full secondary" disabled={earnLoading}>
                {earnLoading ? "처리 중..." : "적립 확정"}
              </button>
            </form>
            {earnError && <p className="error" style={{ marginTop: 10 }}>{earnError}</p>}
            {earnResult && (
              <p className="success-msg" style={{ marginTop: 10 }}>
                {earnResult.earnAmount.toLocaleString()}P 적립 완료
              </p>
            )}
          </div>
        </>
      )}

      {result && (
        <div className="card">
          <div className="card-title">
            결제 완료
            <span className="badge success">완료</span>
          </div>
          {result.breakdown.map((b, i) => (
            <div className="row" key={i}>
              <span className="label">{b.source === "STORE_SELF" ? "이 매장 포인트" : b.source === "HQ" ? "통합포인트" : b.source}</span>
              <span className="value">{b.amount.toLocaleString()}P</span>
            </div>
          ))}
          <p className="faint" style={{ marginTop: 10 }}>
            안내: 위 금액을 카운터 단말(챔프)의 할인란에 직접 입력한 뒤 결제를 완료하세요.
          </p>
        </div>
      )}
    </div>
  );
}
