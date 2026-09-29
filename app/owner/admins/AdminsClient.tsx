"use client";

import { useEffect, useState, useCallback } from "react";

type Company = { _id: string; name: string };
type Admin = { _id: string; name: string; phone: string; companyId: string | null };

export default function AdminsClient() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [admins, setAdmins] = useState<Admin[] | null>(null);
  const [phone, setPhone] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [c, a] = await Promise.all([fetch("/api/v1/owner/companies"), fetch("/api/v1/owner/admins")]);
    const cd = await c.json();
    const ad = await a.json();
    setCompanies(c.ok ? cd.companies : []);
    setAdmins(a.ok ? ad.admins : []);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function assign(targetPhone: string, targetCompanyId: string | null) {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/v1/owner/admins", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: targetPhone, companyId: targetCompanyId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMsg({ text: `실패: ${data.error}`, ok: false });
        return;
      }
      setMsg({
        text: "반영했습니다. 해당 계정은 다시 로그인해야 새 권한이 적용됩니다.",
        ok: true,
      });
      setPhone("");
      load();
    } finally {
      setBusy(false);
    }
  }

  const companyName = (id: string | null) => companies.find((c) => c._id === id)?.name ?? "(미배정)";

  return (
    <div>
      <div className="page-header">
        <div className="eyebrow">소유자</div>
        <h1>운영자 배정</h1>
        <div className="desc">
          이미 가입한 회원의 전화번호로 운영자(고객사 관리자)를 지정합니다. 소유자·매장 관리자 계정은 여기서 바꿀 수
          없습니다.
        </div>
      </div>

      <div className="card">
        <div className="card-title">운영자 지정</div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            assign(phone, companyId);
          }}
        >
          <div className="field">
            <label>회원 휴대폰번호</label>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="01012345678" required />
          </div>
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
          <button type="submit" disabled={busy || !companyId}>
            {busy ? "처리 중..." : "운영자로 지정"}
          </button>
        </form>
        {msg && <p className={msg.ok ? "muted" : "error"}>{msg.text}</p>}
      </div>

      <h2>현재 운영자</h2>
      <div className="card">
        {admins === null && <p className="muted">불러오는 중...</p>}
        {admins?.length === 0 && <p className="faint" style={{ margin: 0 }}>지정된 운영자가 없습니다.</p>}
        {admins?.map((a) => (
          <div className="row" key={a._id}>
            <span>
              <span className="value">{a.name}</span>
              <div className="faint" style={{ marginTop: 4 }}>
                {a.phone} · {companyName(a.companyId)}
              </div>
            </span>
            <button
              type="button"
              className="sm ghost"
              disabled={busy}
              onClick={() => window.confirm(`${a.name}님의 운영자 등급을 해제할까요?`) && assign(a.phone, null)}
            >
              해제
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
