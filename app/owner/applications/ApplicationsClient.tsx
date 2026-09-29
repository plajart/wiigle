"use client";

import { useEffect, useState, useCallback } from "react";

type Application = {
  _id: string;
  storeName: string;
  franchiseCode?: string;
  applicantName: string;
  applicantPhone: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  appliedAt: string;
};

export default function ApplicationsClient() {
  const [apps, setApps] = useState<Application[] | null>(null);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/v1/hq/store-applications?all=1");
    const data = await res.json();
    setApps(data.applications ?? []);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function approve(id: string) {
    setBusyId(id);
    setMsg(null);
    try {
      const res = await fetch(`/api/v1/hq/store-applications/${id}/approve`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setMsg({ text: `승인 실패: ${data.error}`, ok: false });
      } else {
        setMsg({ text: "매장이 생성되고 신청이 승인되었습니다.", ok: true });
        load();
      }
    } finally {
      setBusyId(null);
    }
  }

  async function reject(id: string) {
    const reason = window.prompt("반려 사유(선택, 신청자에게 별도 안내 필요)") ?? undefined;
    setBusyId(id);
    setMsg(null);
    try {
      const res = await fetch(`/api/v1/hq/store-applications/${id}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      const data = await res.json();
      setMsg(res.ok ? { text: "신청이 반려되었습니다.", ok: true } : { text: `실패: ${data.error}`, ok: false });
      if (res.ok) load();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <div className="page-header">
        <div className="eyebrow">플랫폼 관리자</div>
        <h1>매장 가입 신청</h1>
        <div className="desc">매장주가 셀프서비스로 등록 신청한 목록입니다. 승인하면 매장과 매장 관리자 계정이 즉시 생성됩니다.</div>
      </div>

      {msg && <p className={msg.ok ? "success-msg" : "error"}>{msg.text}</p>}

      <div className="card">
        {apps === null && <p className="muted">불러오는 중...</p>}
        {apps?.length === 0 && (
          <div className="empty-state">
            <div className="ic">◐</div>
            대기 중인 신청이 없습니다
          </div>
        )}
        {apps?.map((a) => (
          <div className="row" key={a._id} style={{ alignItems: "flex-start" }}>
            <div>
              <div className="value">{a.storeName}</div>
              <div className="faint" style={{ marginTop: 4 }}>
                {a.applicantName} · {a.applicantPhone}
                {a.franchiseCode ? ` · 코드 ${a.franchiseCode}` : ""}
              </div>
              <div className="faint">{new Date(a.appliedAt).toLocaleString("ko-KR")} 신청</div>
            </div>
            {a.status === "PENDING" ? (
              <div className="btn-row" style={{ margin: 0, width: 160 }}>
                <button type="button" className="sm gold" disabled={busyId === a._id} onClick={() => approve(a._id)}>
                  승인
                </button>
                <button type="button" className="sm secondary" disabled={busyId === a._id} onClick={() => reject(a._id)}>
                  반려
                </button>
              </div>
            ) : (
              <span className={"badge " + (a.status === "APPROVED" ? "success" : "danger")}>
                {a.status === "APPROVED" ? "승인됨" : "반려됨"}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
