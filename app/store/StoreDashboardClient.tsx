"use client";

import { useEffect, useState, useCallback } from "react";

type Summary = { customerCount: number; totalBalance: number };

export default function StoreDashboardClient({ storeId }: { storeId: string }) {
  const [summary, setSummary] = useState<Summary | null>(null);

  const load = useCallback(async () => {
    const s = await fetch(`/api/v1/stores/${storeId}/points/summary`).then((r) => r.json());
    setSummary(s);
  }, [storeId]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div>
      <div className="page-header">
        <div className="eyebrow">매장 관리자</div>
        <h1>대시보드</h1>
      </div>

      {!summary && <p className="muted">불러오는 중...</p>}

      {summary && (
        <>
          <div className="stat-grid">
            <div className="stat-tile">
              <div className="stat-label">포인트 보유 고객 수</div>
              <div className="stat-value">{summary.customerCount.toLocaleString()}</div>
              <div className="stat-sub">명</div>
            </div>
            <div className="stat-tile accent">
              <div className="stat-label">이 매장 적립 포인트 총 잔액</div>
              <div className="stat-value">{summary.totalBalance.toLocaleString()}</div>
              <div className="stat-sub">P</div>
            </div>
          </div>
          <p className="faint">위 수치는 포인트 관리 프로그램에 가입한 고객만 집계됩니다.</p>
        </>
      )}
    </div>
  );
}
