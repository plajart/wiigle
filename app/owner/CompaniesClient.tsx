"use client";

import { useEffect, useState, useCallback } from "react";

type Company = { _id: string; name: string; storeCount: number; adminCount: number };

export default function CompaniesClient() {
  const [companies, setCompanies] = useState<Company[] | null>(null);
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/v1/owner/companies");
    const data = await res.json();
    setCompanies(res.ok ? data.companies : []);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/v1/owner/companies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMsg({ text: `생성 실패: ${data.error}`, ok: false });
        return;
      }
      setNewName("");
      setMsg({ text: "고객사를 만들었습니다.", ok: true });
      load();
    } finally {
      setBusy(false);
    }
  }

  async function rename(id: string) {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/v1/owner/companies/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: editName }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMsg({ text: `이름 변경 실패: ${data.error}`, ok: false });
        return;
      }
      setEditingId(null);
      load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="page-header">
        <div className="eyebrow">소유자</div>
        <h1>고객사 관리</h1>
        <div className="desc">고객사(본사)를 만들고 이름을 바꿉니다. 매장은 고객사 아래에서 운영자가 만듭니다.</div>
      </div>

      <div className="card">
        <div className="card-title">새 고객사</div>
        <form onSubmit={create}>
          <div className="field">
            <label>고객사 이름</label>
            <input value={newName} onChange={(e) => setNewName(e.target.value)} required />
          </div>
          <button type="submit" disabled={busy}>
            {busy ? "처리 중..." : "고객사 만들기"}
          </button>
        </form>
        {msg && <p className={msg.ok ? "muted" : "error"}>{msg.text}</p>}
      </div>

      <h2>고객사 목록</h2>
      <div className="card">
        {companies === null && <p className="muted">불러오는 중...</p>}
        {companies?.length === 0 && <p className="faint" style={{ margin: 0 }}>아직 고객사가 없습니다.</p>}
        {companies?.map((c) => (
          <div className="row" key={c._id}>
            {editingId === c._id ? (
              <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input value={editName} onChange={(e) => setEditName(e.target.value)} />
                <button type="button" className="sm" disabled={busy} onClick={() => rename(c._id)}>
                  저장
                </button>
                <button type="button" className="sm ghost" onClick={() => setEditingId(null)}>
                  취소
                </button>
              </span>
            ) : (
              <>
                <span>
                  <span className="value">{c.name}</span>
                  <div className="faint" style={{ marginTop: 4 }}>
                    매장 {c.storeCount}개 · 운영자 {c.adminCount}명
                  </div>
                </span>
                <button
                  type="button"
                  className="sm ghost"
                  onClick={() => {
                    setEditingId(c._id);
                    setEditName(c.name);
                  }}
                >
                  이름 변경
                </button>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
