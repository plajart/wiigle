"use client";

import { useEffect, useState, useCallback } from "react";

type Company = { _id: string; name: string };
type Application = {
  _id: string;
  type?: "NEW_COMPANY" | "ADD_STORE";
  companyName?: string;
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
  const [companies, setCompanies] = useState<Company[]>([]);
  // 신청별로 "어느 고객사에 붙일지" — "" 이면 새 고객사를 만든다
  const [target, setTarget] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    const res = await fetch("/api/v1/hq/store-applications?all=1");
    const data = await res.json();
    const list: Application[] = data.applications ?? [];
    setApps(list);
    const cRes = await fetch("/api/v1/owner/companies");
    const cData = await cRes.json();
    const cs: Company[] = cRes.ok ? cData.companies : [];
    setCompanies(cs);
    // 신청자가 적은 고객사 이름과 같은 기존 고객사가 있으면 기본으로 그 고객사에 붙인다(중복 고객사 생성 방지)
    setTarget((prev) => {
      const next = { ...prev };
      for (const a of list) {
        if (next[a._id] === undefined) next[a._id] = cs.find((c) => c.name === a.companyName)?._id ?? "";
      }
      return next;
    });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function approve(id: string) {
    setBusyId(id);
    setMsg(null);
    try {
      const res = await fetch(`/api/v1/hq/store-applications/${id}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId: target[id] || undefined }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMsg({
          text:
            data.error === "COMPANY_NAME_EXISTS"
              ? "같은 이름의 고객사가 이미 있습니다. '기존 고객사에 추가'에서 그 고객사를 선택해 승인하세요."
              : data.error === "PHONE_ALREADY_USED"
                ? "이미 가입된 번호입니다."
                : `승인 실패: ${data.error}`,
          ok: false,
        });
        if (data.error === "COMPANY_NAME_EXISTS" && data.existingCompanyId) setTarget((t) => ({ ...t, [id]: data.existingCompanyId }));
      } else {
        setMsg({ text: "매장이 등록되고 신청이 승인되었습니다.", ok: true });
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
        <div className="eyebrow">본사 관리모드</div>
        <h1>고객사·매장 등록 신청</h1>
        <div className="desc">
          셀프서비스로 들어온 등록 신청입니다. 승인할 때 <b>새 고객사로 만들지, 기존 고객사에 매장으로 추가할지</b> 고르면 매장과
          신청자의 매장 관리자 계정이 생성됩니다. 신청자에게 결과가 자동으로 알려지지는 않습니다.
        </div>
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
              <div className="value">
                {a.storeName}
                <span className="badge neutral" style={{ marginLeft: 8 }}>
                  {a.type === "ADD_STORE" ? "기존 고객사에 추가" : "새 고객사"}
                </span>
              </div>
              <div className="faint" style={{ marginTop: 4 }}>
                신청한 고객사: <b>{a.companyName ?? "-"}</b>
              </div>
              <div className="faint" style={{ marginTop: 4 }}>
                {a.applicantName} · {a.applicantPhone}
                {a.franchiseCode ? ` · 코드 ${a.franchiseCode}` : ""}
              </div>
              <div className="faint">{new Date(a.appliedAt).toLocaleString("ko-KR")} 신청</div>
            </div>
            {a.status === "PENDING" ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 8, width: 220 }}>
                <select
                  value={target[a._id] ?? ""}
                  onChange={(e) => setTarget((t) => ({ ...t, [a._id]: e.target.value }))}
                  style={{ marginBottom: 0 }}
                >
                  <option value="">새 고객사 &lsquo;{a.companyName}&rsquo; 만들기</option>
                  {companies.map((c) => (
                    <option key={c._id} value={c._id}>
                      기존 고객사에 추가: {c.name}
                    </option>
                  ))}
                </select>
                <div className="btn-row" style={{ margin: 0 }}>
                <button type="button" className="sm gold" disabled={busyId === a._id} onClick={() => approve(a._id)}>
                  승인
                </button>
                <button type="button" className="sm secondary" disabled={busyId === a._id} onClick={() => reject(a._id)}>
                  반려
                </button>
                </div>
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
