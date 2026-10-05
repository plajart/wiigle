"use client";

import { useCallback, useEffect, useState } from "react";

type Store = { _id: string; name: string; franchiseCode?: string };
type Manager = { _id: string; name: string; phone: string };
type Msg = { text: string; ok: boolean };

const ERRORS: Record<string, string> = {
  USER_NOT_FOUND: "가입되지 않은 번호입니다. 이름을 입력하면 계정을 새로 만들어 지정합니다.",
  CANNOT_CHANGE_THIS_ROLE: "본사(소유자) 또는 고객사 운영자 계정은 매장 관리자로 지정할 수 없습니다.",
  ALREADY_MANAGER: "이미 이 매장의 관리자입니다.",
  MANAGER_OF_OTHER_COMPANY: "다른 고객사 매장의 관리자입니다.",
  INVALID_PHONE: "휴대폰번호를 확인해주세요.",
};

// 매장 한 곳의 관리자 목록·지정·해제
function ManagersPanel({ store, onRenamed }: { store: Store; onRenamed: () => void }) {
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(store.name);
  const [managers, setManagers] = useState<Manager[] | null>(null);
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg | null>(null);
  const [tempPw, setTempPw] = useState<{ phone: string; password: string } | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/v1/stores/${store._id}/managers`);
    const data = await res.json();
    setManagers(res.ok ? data.managers : []);
  }, [store._id]);

  useEffect(() => {
    load();
  }, [load]);

  async function assign(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    setTempPw(null);
    try {
      const res = await fetch(`/api/v1/stores/${store._id}/managers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, name: name.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMsg({ text: ERRORS[data.error] ?? `실패: ${data.error}`, ok: false });
        return;
      }
      if (data.tempPassword) setTempPw({ phone: data.phone, password: data.tempPassword });
      setMsg({ text: "관리자로 지정했습니다.", ok: true });
      setPhone("");
      setName("");
      load();
    } finally {
      setBusy(false);
    }
  }

  async function unassign(m: Manager) {
    if (!window.confirm(`${m.name}님의 매장 관리자 권한을 해제할까요?`)) return;
    await fetch(`/api/v1/stores/${store._id}/managers?userId=${m._id}`, { method: "DELETE" });
    load();
  }

  async function rename(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    const res = await fetch(`/api/v1/stores/${store._id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: editName }),
    });
    if (!res.ok) {
      setMsg({ text: "이름을 바꾸지 못했습니다. 이름을 확인하고 다시 시도해 주세요.", ok: false });
      return;
    }
    setEditing(false);
    onRenamed();
  }

  return (
    <div className="card">
      <div className="card-title">
        {editing ? (
          <form onSubmit={rename} style={{ display: "flex", gap: 8 }}>
            <input style={{ marginBottom: 0 }} value={editName} onChange={(e) => setEditName(e.target.value)} required />
            <button type="submit" className="sm">저장</button>
            <button type="button" className="sm ghost" onClick={() => setEditing(false)}>취소</button>
          </form>
        ) : (
          <>
            {store.name}
            <button type="button" className="sm ghost" style={{ marginLeft: 8 }} onClick={() => { setEditName(store.name); setEditing(true); }}>
              이름 변경
            </button>
          </>
        )}
      </div>
      {managers === null && <p className="muted">불러오는 중...</p>}
      {managers?.length === 0 && (
        <p className="faint" style={{ margin: "0 0 12px" }}>
          지정된 관리자가 없습니다(계정 없이 매장 정보만 있는 상태).
        </p>
      )}
      {managers?.map((m) => (
        <div className="row" key={m._id}>
          <span>
            <span className="value">{m.name}</span>
            <div className="faint" style={{ marginTop: 4 }}>
              {m.phone}
            </div>
          </span>
          <button type="button" className="sm ghost" onClick={() => unassign(m)}>
            해제
          </button>
        </div>
      ))}
      <form onSubmit={assign} style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
        <input
          style={{ marginBottom: 0, maxWidth: 160 }}
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="휴대폰번호"
          required
        />
        <input
          style={{ marginBottom: 0, maxWidth: 160 }}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="이름(미가입 번호일 때)"
        />
        <button type="submit" className="sm" disabled={busy}>
          관리자 지정
        </button>
      </form>
      {msg && <p className={msg.ok ? "muted" : "error"}>{msg.text}</p>}
      {tempPw && (
        <p className="success-msg">
          {tempPw.phone} 임시 비밀번호: <b>{tempPw.password}</b> — 본인에게 안전하게 전달하세요(다시 볼 수 없습니다).
        </p>
      )}
    </div>
  );
}

export default function StoresClient({ isOwner }: { isOwner: boolean }) {
  const [stores, setStores] = useState<Store[] | null>(null);
  const [storeName, setStoreName] = useState("");
  const [franchiseCode, setFranchiseCode] = useState("");
  const [adminPhone, setAdminPhone] = useState("");
  const [adminName, setAdminName] = useState("");
  const [createMsg, setCreateMsg] = useState<Msg | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/v1/stores");
    const data = await res.json();
    setStores(res.ok ? data.stores : []);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function createStore(e: React.FormEvent) {
    e.preventDefault();
    setCreateMsg(null);
    setBusy(true);
    try {
      const res = await fetch("/api/v1/stores", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: storeName, franchiseCode, adminPhone: adminPhone || undefined, adminName: adminName || undefined }),
      });
      const data = await res.json();
      if (!res.ok) {
        setCreateMsg({ text: `생성 실패: ${data.error}`, ok: false });
        return;
      }
      let text = "매장을 만들었습니다.";
      if (data.storeManager?.tempPassword) {
        text += ` 관리자 ${data.storeManager.phone}의 임시 비밀번호: ${data.storeManager.tempPassword} — 안전하게 전달하세요(다시 볼 수 없습니다).`;
      } else if (data.storeManager) {
        text += " 관리자로 지정했습니다.";
      } else if (data.managerError) {
        text += ` (관리자 지정은 실패했습니다: ${ERRORS[data.managerError] ?? data.managerError} — 아래에서 다시 지정하세요.)`;
      }
      setCreateMsg({ text, ok: !data.managerError });
      setStoreName("");
      setFranchiseCode("");
      setAdminPhone("");
      setAdminName("");
      load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="page-header">
        <div className="eyebrow">{isOwner ? "본사 · 고객사 관리모드" : "고객사 관리모드"}</div>
        <h1>매장 · 관리자</h1>
        <div className="desc">
          현재 고객사에 매장을 등록하고, 매장별로 관리자를 지정합니다. 관리자는 나중에 지정해도 됩니다(계정 없이 매장 정보만
          먼저 등록 가능).
        </div>
      </div>

      <div className="card">
        <div className="card-title">매장 등록</div>
        <form onSubmit={createStore}>
          <div className="field">
            <label>매장명</label>
            <input value={storeName} onChange={(e) => setStoreName(e.target.value)} required />
          </div>
          <div className="field">
            <label>프랜차이즈 코드 (선택)</label>
            <input value={franchiseCode} onChange={(e) => setFranchiseCode(e.target.value)} />
          </div>
          <div className="field">
            <label>매장 관리자 휴대폰번호 (선택)</label>
            <input value={adminPhone} onChange={(e) => setAdminPhone(e.target.value)} placeholder="01012345678" />
          </div>
          <div className="field">
            <label>매장 관리자 이름 (선택 — 가입하지 않은 번호일 때 계정을 만들려면 입력)</label>
            <input value={adminName} onChange={(e) => setAdminName(e.target.value)} />
          </div>
          {createMsg && <p className={createMsg.ok ? "success-msg" : "error"}>{createMsg.text}</p>}
          <button type="submit" className="full" disabled={busy}>
            {busy ? "등록 중..." : "매장 등록"}
          </button>
        </form>
      </div>

      <h2>매장별 관리자</h2>
      {stores === null && (
        <div className="card">
          <p className="muted">불러오는 중...</p>
        </div>
      )}
      {stores?.length === 0 && (
        <div className="card">
          <p className="faint" style={{ margin: 0 }}>등록된 매장이 없습니다.</p>
        </div>
      )}
      {stores?.map((s) => (
        <ManagersPanel key={s._id} store={s} onRenamed={load} />
      ))}
    </div>
  );
}
