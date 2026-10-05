"use client";

import { useCallback, useEffect, useState } from "react";

type Company = { _id: string; name: string; customerWebEnabled: boolean };

export default function CustomerAccessClient() {
  const [companies, setCompanies] = useState<Company[] | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/v1/owner/companies");
    const data = await res.json().catch(() => ({}));
    setCompanies(res.ok ? data.companies : []);
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  async function toggle(c: Company) {
    const next = !c.customerWebEnabled;
    const text = next
      ? `"${c.name}" 고객의 웹 포인트 조회를 다시 엽니다. 진행할까요?`
      : `"${c.name}" 고객은 웹에서 포인트를 조회할 수 없게 됩니다(그 고객사에서만 이용한 고객은 로그인도 막힙니다). 포스 적립·사용에는 영향이 없습니다. 진행할까요?`;
    if (!window.confirm(text)) return;
    setMsg(null);
    const res = await fetch(`/api/v1/owner/companies/${c._id}/customer-access`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: next }),
    });
    if (!res.ok) setMsg("변경하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    load();
  }

  return (
    <div>
      <div className="page-header">
        <div className="eyebrow">본사 관리모드</div>
        <h1>고객 웹 조회 설정</h1>
        <div className="desc">고객사별로 고객이 웹에서 자기 포인트를 확인할 수 있게 열거나 닫습니다. 닫아도 매장 포스의 적립·사용은 그대로 동작합니다.</div>
      </div>
      <div className="card">
        {companies === null && <p className="muted">불러오는 중...</p>}
        {companies?.length === 0 && <p className="faint" style={{ margin: 0 }}>등록된 고객사가 없습니다.</p>}
        {companies?.map((c) => (
          <div className="row" key={c._id}>
            <span className="value">{c.name}</span>
            <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span className={"badge " + (c.customerWebEnabled ? "success" : "neutral")}>{c.customerWebEnabled ? "고객 웹 조회 열림" : "닫힘"}</span>
              <button type="button" className="sm ghost" onClick={() => toggle(c)}>
                {c.customerWebEnabled ? "닫기" : "열기"}
              </button>
            </span>
          </div>
        ))}
        {msg && <p className="error">{msg}</p>}
      </div>
    </div>
  );
}
