"use client";

import { useEffect, useState, useCallback } from "react";

type Scopes = { scopes: string[] };

const SCOPE_LABEL: Record<string, string> = {
  read_balance: "고객 포인트 잔액 조회",
  read_history: "적립/사용 이력 조회",
  write_redeem: "포인트 사용(차감) 처리 — POS 앱에서 차감 확정 허용",
  write_earn: "포인트 적립 처리 — POS 앱에서 적립 허용",
  accept_transfer: "통합포인트·같은 고객사 다른 매장 포인트 사용 허용 (고객이 이 매장에서 같은 고객사의 통합포인트와 다른 매장 포인트를 즉시 사용)",
};

export default function ConsentClient({ storeId }: { storeId: string }) {
  const [scopes, setScopes] = useState<string[] | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    const data = await fetch(`/api/v1/stores/${storeId}/pos-integration/scopes`).then((r) => r.json());
    setScopes((data.posIntegration as Scopes)?.scopes ?? []);
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

    </div>
  );
}
