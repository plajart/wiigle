"use client";

import { useEffect, useState, useCallback } from "react";

type Scopes = { scopes: string[] };

const SCOPE_LABEL: Record<string, string> = {
  read_balance: "고객 포인트 잔액 조회",
  read_history: "적립/사용 이력 조회",
  write_redeem: "포인트 사용(차감) 처리 — POS 앱에서 차감 확정 허용",
  write_earn: "포인트 적립 처리 — POS 앱에서 결제금액 기준 적립 허용",
  accept_transfer: "본사/타매장 포인트 사용 허용 (고객이 이 매장에서 본사·타매장 포인트를 즉시 사용)",
};

export default function ConsentClient({ storeId }: { storeId: string }) {
  const [scopes, setScopes] = useState<string[] | null>(null);
  const [earnRatePct, setEarnRatePct] = useState<string>("3");
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    const data = await fetch(`/api/v1/stores/${storeId}/pos-integration/scopes`).then((r) => r.json());
    setScopes((data.posIntegration as Scopes)?.scopes ?? []);
    const rate = data.pointPolicy?.earnRate ?? 0.03;
    setEarnRatePct(String(Math.round(rate * 1000) / 10));
  }, [storeId]);

  useEffect(() => {
    load();
  }, [load]);

  async function toggleScope(scope: string) {
    if (!scopes) return;
    const next = scopes.includes(scope) ? scopes.filter((s) => s !== scope) : [...scopes, scope];
    setScopes(next);
    await fetch(`/api/v1/stores/${storeId}/pos-integration/scopes`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scopes: next }),
    });
    setMsg("연동 동의 항목이 저장되었습니다.");
  }

  async function saveEarnRate(e: React.FormEvent) {
    e.preventDefault();
    if (!scopes) return;
    const pct = Number(earnRatePct);
    if (Number.isNaN(pct) || pct < 0 || pct > 100) return;
    await fetch(`/api/v1/stores/${storeId}/pos-integration/scopes`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scopes, earnRate: pct / 100 }),
    });
    setMsg("적립률이 저장되었습니다.");
  }

  return (
    <div>
      <div className="page-header">
        <div className="eyebrow">매장 관리자</div>
        <h1>POS 연동 동의</h1>
        <div className="desc">매장 관리자만 설정할 수 있으며, 언제든 철회할 수 있습니다.</div>
      </div>

      <div className="card">
        {scopes === null && <p className="muted">불러오는 중...</p>}
        {scopes !== null &&
          Object.entries(SCOPE_LABEL).map(([key, label]) => (
            <div className="row" key={key}>
              <span className="label" style={{ flex: 1, paddingRight: 16 }}>
                {label}
              </span>
              <label className="switch">
                <input type="checkbox" checked={scopes.includes(key)} onChange={() => toggleScope(key)} />
                <span className="switch-track" />
              </label>
            </div>
          ))}
        {msg && <p className="success-msg" style={{ marginTop: 14 }}>{msg}</p>}
      </div>

      {scopes !== null && (
        <div className="card">
          <div className="card-title">적립률</div>
          <p className="faint" style={{ marginBottom: 12 }}>
            POS 앱(concrab.com/pos)에서 계산원이 직접 적립 처리할 때만 적용되는 비율입니다.
            <br />
            매장 결제 프로그램(챔프 등)과 연동된 경우, 실제 결제 시 적립액은 그 프로그램 자체의
            설정을 그대로 따릅니다 — 이 비율은 그 결제에는 적용되지 않습니다.
          </p>
          <form onSubmit={saveEarnRate} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
            <input
              style={{ marginBottom: 0, maxWidth: 120 }}
              type="number"
              min={0}
              max={100}
              step={0.1}
              value={earnRatePct}
              onChange={(e) => setEarnRatePct(e.target.value)}
            />
            <button type="submit" className="secondary">
              저장 (%)
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
