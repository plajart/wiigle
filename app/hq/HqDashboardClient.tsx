"use client";

import { useCallback, useEffect, useState } from "react";
import { ManagersPanel } from "./stores/StoresClient";

type Store = { _id: string; name: string; franchiseCode?: string; companyId: string; companyName: string };

export default function HqDashboardClient({ isOwner }: { isOwner: boolean }) {
  const [stores, setStores] = useState<Store[] | null>(null);
  // 매장 한 곳의 "이름 변경·관리자 지정" 패널을 이 화면에서 바로 연다(별도 메뉴로 가지 않아도 되게).
  const [open, setOpen] = useState<{ id: string; rename: boolean } | null>(null);

  const load = useCallback(() => {
    fetch("/api/v1/stores")
      .then((r) => r.json())
      .then((d) => setStores(Array.isArray(d.stores) ? d.stores : []))
      .catch(() => setStores((prev) => prev ?? []));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div>
      <div className="page-header">
        <div className="eyebrow">{isOwner ? "본사 · 고객사 관리모드" : "고객사 관리모드"}</div>
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
      {stores && stores.length > 0 && (
        <div className="card">
          {stores.map((s) => (
            <div key={s._id}>
              <div className="row">
                <span>
                  <span className="value">{s.name}</span>
                  {s.franchiseCode && (
                    <div className="faint" style={{ marginTop: 4 }}>
                      {s.franchiseCode}
                    </div>
                  )}
                </span>
                <span style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <button type="button" className="sm ghost" onClick={() => setOpen(open?.id === s._id && open.rename ? null : { id: s._id, rename: true })}>
                    이름 변경
                  </button>
                  <button type="button" className="sm ghost" onClick={() => setOpen(open?.id === s._id && !open.rename ? null : { id: s._id, rename: false })}>
                    관리자 지정
                  </button>
                  {/* <a>로 건다 — 이동하면서 서버가 현재 매장을 기억시킨다(미리읽기 방지) */}
                  <a href={`/store/enter?storeId=${encodeURIComponent(s._id)}`}>
                    <button type="button" className="sm">
                      매장 관리모드 열기
                    </button>
                  </a>
                </span>
              </div>
              {open?.id === s._id && (
                <div style={{ padding: "0 0 12px" }}>
                  <ManagersPanel
                    key={open.rename ? "rename" : "managers"}
                    store={s}
                    startEditing={open.rename}
                    onRenamed={() => {
                      load();
                      setOpen(null);
                    }}
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
