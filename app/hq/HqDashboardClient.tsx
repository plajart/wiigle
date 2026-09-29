"use client";

import { useEffect, useState } from "react";

type Store = { _id: string; name: string; franchiseCode?: string; companyId: string; companyName: string };

export default function HqDashboardClient({ isOwner }: { isOwner: boolean }) {
  const [stores, setStores] = useState<Store[] | null>(null);

  useEffect(() => {
    fetch("/api/v1/stores")
      .then((r) => r.json())
      .then((d) => setStores(d.stores ?? []));
  }, []);

  // 소유자는 여러 고객사의 매장을 보므로 고객사별로 묶어서 보여준다. 운영자는 자기 고객사 하나뿐.
  const groups = new Map<string, { name: string; stores: Store[] }>();
  for (const s of stores ?? []) {
    if (!groups.has(s.companyId)) groups.set(s.companyId, { name: s.companyName, stores: [] });
    groups.get(s.companyId)!.stores.push(s);
  }

  return (
    <div>
      <div className="page-header">
        <div className="eyebrow">{isOwner ? "소유자" : "운영자"}</div>
        <h1>대시보드</h1>
        <div className="desc">
          매장을 누르면 그 매장의 관리모드로 들어가 <b>매장 관리자와 같은 권한</b>으로 설정하고 관리할 수 있습니다.
        </div>
      </div>

      <div className="stat-grid">
        <div className="stat-tile accent">
          <div className="stat-label">소속 매장 수</div>
          <div className="stat-value">{stores ? stores.length : "-"}</div>
        </div>
        {isOwner && (
          <div className="stat-tile">
            <div className="stat-label">고객사 수</div>
            <div className="stat-value">{stores ? groups.size : "-"}</div>
          </div>
        )}
      </div>

      <h2>매장 목록</h2>
      {stores === null && (
        <div className="card">
          <p className="muted">불러오는 중...</p>
        </div>
      )}
      {stores?.length === 0 && (
        <div className="card">
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
        </div>
      )}
      {[...groups.entries()].map(([companyId, g]) => (
        <div className="card" key={companyId}>
          {isOwner && <div className="card-title">{g.name}</div>}
          {g.stores.map((s) => (
            <div className="row" key={s._id}>
              <span>
                <span className="value">{s.name}</span>
                <div className="faint" style={{ marginTop: 4 }}>
                  {s.companyName}
                  {s.franchiseCode ? ` · ${s.franchiseCode}` : ""}
                </div>
              </span>
              {/* <a>로 건다 — 이동하면서 서버가 현재 매장을 기억시킨다(미리읽기 방지) */}
              <a href={`/store/enter?storeId=${encodeURIComponent(s._id)}`}>
                <button type="button" className="sm">
                  매장 관리모드 열기
                </button>
              </a>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
