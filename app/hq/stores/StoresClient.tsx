"use client";

import { useEffect, useState } from "react";

type Company = { _id: string; name: string };

export default function StoresClient({ isOwner }: { isOwner: boolean }) {
  const [storeName, setStoreName] = useState("");
  const [franchiseCode, setFranchiseCode] = useState("");
  const [adminPhone, setAdminPhone] = useState("");
  const [adminName, setAdminName] = useState("");
  const [createMsg, setCreateMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  // 소유자는 어느 고객사에 만들지 골라야 한다(운영자는 자기 고객사에 자동으로 만들어진다).
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyId, setCompanyId] = useState("");

  useEffect(() => {
    if (!isOwner) return;
    fetch("/api/v1/owner/companies")
      .then((r) => r.json())
      .then((d) => setCompanies(d.companies ?? []));
  }, [isOwner]);

  async function createStore(e: React.FormEvent) {
    e.preventDefault();
    setCreateMsg(null);
    setBusy(true);
    try {
      const res = await fetch("/api/v1/stores", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: storeName, franchiseCode, adminPhone, adminName, companyId: isOwner ? companyId : undefined }),
      });
      const data = await res.json();
      if (!res.ok) {
        setCreateMsg({ text: `생성 실패: ${data.error}`, ok: false });
      } else {
        setCreateMsg({
          text: `매장 생성 완료. 매장 관리자 임시 비밀번호: ${data.storeManager.tempPassword} — 안전하게 전달 후 최초 로그인 시 변경을 안내해주세요.`,
          ok: true,
        });
        setStoreName("");
        setFranchiseCode("");
        setAdminPhone("");
        setAdminName("");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="page-header">
        <div className="eyebrow">{isOwner ? "소유자" : "운영자"}</div>
        <h1>매장 생성</h1>
        <div className="desc">새 매장과 매장 관리자 계정을 함께 생성합니다.</div>
      </div>
      <div className="card">
        <form onSubmit={createStore}>
          {isOwner && (
            <div className="field">
              <label>고객사</label>
              <select value={companyId} onChange={(e) => setCompanyId(e.target.value)} required>
                <option value="">선택...</option>
                {companies.map((c) => (
                  <option key={c._id} value={c._id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="field">
            <label>매장명</label>
            <input value={storeName} onChange={(e) => setStoreName(e.target.value)} required />
          </div>
          <div className="field">
            <label>프랜차이즈 코드 (선택)</label>
            <input value={franchiseCode} onChange={(e) => setFranchiseCode(e.target.value)} />
          </div>
          <div className="field">
            <label>매장 관리자 휴대폰번호</label>
            <input value={adminPhone} onChange={(e) => setAdminPhone(e.target.value)} placeholder="01012345678" required />
          </div>
          <div className="field">
            <label>매장 관리자 이름</label>
            <input value={adminName} onChange={(e) => setAdminName(e.target.value)} required />
          </div>
          {createMsg && <p className={createMsg.ok ? "success-msg" : "error"}>{createMsg.text}</p>}
          <button type="submit" className="full" disabled={busy}>
            {busy ? "생성 중..." : "매장 생성"}
          </button>
        </form>
      </div>
      <p className="faint">생성된 매장 목록과 매장별 현황은 대시보드에서 확인할 수 있습니다.</p>
    </div>
  );
}
