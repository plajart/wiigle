"use client";

import { useState } from "react";

type CustomerInfo = { customerId: string; name: string; phone: string; total: number };
type EventItem = {
  _id: string;
  type: string;
  amount: number;
  status: string;
  storeId?: { name?: string } | null;
  occurredAt: string;
  reason?: string;
};

const TYPE_LABEL: Record<string, string> = {
  EARN: "적립",
  REDEEM: "사용",
  TRANSFER_OUT: "이체 출금",
  TRANSFER_IN: "이체 입금",
  GRANT: "지급",
  ADJUST: "조정",
};

export default function CustomersClient() {
  const [phone, setPhone] = useState("");
  const [customer, setCustomer] = useState<CustomerInfo | null>(null);
  const [events, setEvents] = useState<EventItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function search(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setCustomer(null);
    setEvents(null);
    setLoading(true);
    try {
      const res = await fetch(`/api/v1/hq/customers/search?phone=${encodeURIComponent(phone)}`);
      const data = await res.json();
      if (!res.ok) {
        setError(data.error === "CUSTOMER_NOT_FOUND" ? "이 고객사에서 이용한 고객을 찾을 수 없습니다." : data.error);
        return;
      }
      setCustomer(data);
      const evRes = await fetch(`/api/v1/hq/customers/${data.customerId}/usage`);
      const evData = await evRes.json();
      setEvents(evData.events ?? []);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <div className="page-header">
        <div className="eyebrow">고객사 관리모드</div>
        <h1>고객 조회</h1>
        <div className="desc">전화번호로 고객을 찾아 <b>이 고객사에서의</b> 포인트 현황과 이용내역을 확인합니다. 이 고객사에서 이용한 적이 없는 고객은 조회되지 않습니다.</div>
      </div>

      <div className="card">
        <form onSubmit={search} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
          <input
            style={{ marginBottom: 0 }}
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="01012345678"
            required
          />
          <button type="submit" disabled={loading}>
            {loading ? "조회 중..." : "조회"}
          </button>
        </form>
        {error && <p className="error" style={{ marginTop: 12, marginBottom: 0 }}>{error}</p>}
      </div>

      {customer && (
        <>
          <div className="card">
            <div className="card-title">
              {customer.name}
              <span className="badge gold">{customer.phone}</span>
            </div>
            <div className="row">
              <span className="label">이 고객사의 사용 가능 포인트</span>
              <span className="value" style={{ fontSize: 17, color: "var(--gold-text)" }}>
                {customer.total.toLocaleString()}P
              </span>
            </div>
          </div>

          <h2>전체 이용내역</h2>
          <div className="card">
            {events && events.length === 0 && (
              <div className="empty-state">
                <div className="ic">≡</div>
                이용 내역이 없습니다
              </div>
            )}
            {events && events.length > 0 && (
              <table>
                <thead>
                  <tr>
                    <th>일시</th>
                    <th>매장</th>
                    <th>구분</th>
                    <th>사유</th>
                    <th style={{ textAlign: "right" }}>금액</th>
                  </tr>
                </thead>
                <tbody>
                  {events.map((ev) => (
                    <tr key={ev._id}>
                      <td className="faint">{new Date(ev.occurredAt).toLocaleString("ko-KR")}</td>
                      <td>{ev.storeId?.name ?? "통합포인트"}</td>
                      <td>
                        <span className="badge neutral">{TYPE_LABEL[ev.type] ?? ev.type}</span>
                      </td>
                      <td className="faint">{ev.reason ?? "-"}</td>
                      <td style={{ textAlign: "right", fontWeight: 600 }}>{ev.amount.toLocaleString()}P</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  );
}
