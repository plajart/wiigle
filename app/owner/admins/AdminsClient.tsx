"use client";

import { useEffect, useState, useCallback } from "react";

type Company = { _id: string; name: string };
type Admin = { _id: string; name: string; phone: string; companyId: string | null };

const ERRORS: Record<string, string> = {
  USER_NOT_FOUND: "가입되지 않은 번호입니다. 이름을 입력하면 계정을 새로 만들어 지정합니다.",
  CANNOT_CHANGE_THIS_ROLE: "본사(소유자) 또는 매장 관리자 계정은 고객사 운영자로 바꿀 수 없습니다.",
  INVALID_PHONE: "휴대폰번호를 확인해주세요.",
  COMPANY_NOT_FOUND: "고객사를 찾을 수 없습니다.",
};

export default function AdminsClient({ initialCompanyId }: { initialCompanyId: string }) {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [admins, setAdmins] = useState<Admin[] | null>(null);
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [companyId, setCompanyId] = useState(initialCompanyId);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [tempPw, setTempPw] = useState<{ phone: string; password: string } | null>(null);
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

  async function assign(targetPhone: string, targetCompanyId: string | null, targetName?: string) {
    setBusy(true);
    setMsg(null);
    setTempPw(null);
    try {
      const res = await fetch("/api/v1/owner/admins", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: targetPhone, companyId: targetCompanyId, name: targetName || undefined }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMsg({ text: ERRORS[data.error] ?? `실패: ${data.error}`, ok: false });
        return;
      }
      if (data.tempPassword) {
        setTempPw({ phone: data.phone, password: data.tempPassword });
        setMsg({ text: "지정했습니다. 아래 임시 비밀번호를 본인에게 안전하게 전달하세요(다시 볼 수 없습니다).", ok: true });
      } else {
        setMsg({ text: "반영했습니다. 해당 계정은 다시 로그인해야 새 권한이 적용됩니다.", ok: true });
      }
      setPhone("");
      setName("");
      load();
    } finally {
      setBusy(false);
    }
  }

  const companyName = (id: string | null) => companies.find((c) => c._id === id)?.name ?? "(미배정)";

  return (
    <div>
      <div className="page-header">
        <div className="eyebrow">본사 관리모드</div>
        <h1>고객사 운영자 지정</h1>
        <div className="desc">
          고객사의 운영자를 지정합니다. 운영자는 자기 고객사에서 매장을 등록하고 매장 관리자를 지정할 수 있습니다. 이미 가입한
          고객은 전화번호만, 가입하지 않은 번호는 이름을 함께 입력하면 계정을 새로 만들어 지정합니다. 본사·매장 관리자
          계정은 여기서 바꿀 수 없습니다.
        </div>
      </div>

      <div className="card">
        <div className="card-title">고객사 운영자 지정</div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            assign(phone, companyId, name.trim());
          }}
        >
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
          <div className="field">
            <label>휴대폰번호</label>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="01012345678" required />
          </div>
          <div className="field">
            <label>이름 (가입하지 않은 번호일 때만)</label>
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <button type="submit" disabled={busy || !companyId}>
            {busy ? "처리 중..." : "운영자로 지정"}
          </button>
        </form>
        {msg && <p className={msg.ok ? "muted" : "error"}>{msg.text}</p>}
        {tempPw && (
          <p className="success-msg">
            {tempPw.phone} 임시 비밀번호: <b>{tempPw.password}</b>
          </p>
        )}
      </div>

      <h2>현재 고객사 운영자</h2>
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
              onClick={() => window.confirm(`${a.name}님의 고객사 운영자 권한을 해제할까요?`) && assign(a.phone, null)}
            >
              해제
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
