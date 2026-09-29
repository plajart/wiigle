"use client";

import { useEffect, useState } from "react";

type Store = { _id: string; name: string; franchiseCode?: string };

export default function HqDashboardClient() {
  const [stores, setStores] = useState<Store[] | null>(null);

  useEffect(() => {
    fetch("/api/v1/stores")
      .then((r) => r.json())
      .then((d) => setStores(d.stores ?? []));
  }, []);

  return (
    <div>
      <div className="page-header">
        <div className="eyebrow">플랫폼 관리자</div>
        <h1>대시보드</h1>
      </div>

      <div className="stat-grid">
        <div className="stat-tile accent">
          <div className="stat-label">등록 매장 수</div>
          <div className="stat-value">{stores ? stores.length : "-"}</div>
        </div>
      </div>

      <h2>매장 목록</h2>
      <div className="card">
        {stores === null && <p className="muted">불러오는 중...</p>}
        {stores?.length === 0 && (
          <div className="empty-state">
            <div className="ic">◈</div>
            등록된 매장이 없습니다
            <div style={{ marginTop: 14 }}>
              <a href="/hq/stores">
                <button type="button" className="sm">
                  매장 생성하기
                </button>
              </a>
            </div>
          </div>
        )}
        {stores?.map((s) => (
          <div className="row" key={s._id}>
            <span className="value">{s.name}</span>
            <span className="faint">{s.franchiseCode ?? "-"}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
