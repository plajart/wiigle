"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

const ERRORS: Record<string, string> = {
  WRONG_CURRENT_PASSWORD: "현재 비밀번호가 맞지 않습니다.",
  PASSWORD_TOO_SHORT: "새 비밀번호는 8자 이상이어야 합니다.",
  PASSWORD_TOO_LONG: "새 비밀번호가 너무 깁니다.",
  SAME_PASSWORD: "현재 비밀번호와 다른 비밀번호를 입력해주세요.",
  TOO_MANY_REQUESTS: "요청이 너무 많습니다. 잠시 후 다시 시도해주세요.",
};

// 로그인 전에 영수증 QR로 들어왔다면(pendingClaimToken) 안내가 끝난 뒤 그 연결 화면으로, 아니면 내 포인트로.
function nextAfterFirstLogin(): string {
  try {
    const t = localStorage.getItem("pendingClaimToken");
    if (t) {
      localStorage.removeItem("pendingClaimToken");
      return `/claim/${t}`;
    }
  } catch {
    // localStorage 접근 불가 시 그냥 /me로
  }
  return "/me";
}

export default function ChangePasswordClient() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  // 초기·임시 비밀번호로 방금 처음 로그인한 경우 — 현재 비밀번호 입력 없이 바로 바꾸게 안내한다(이번 한 번만).
  const [firstLogin, setFirstLogin] = useState(false);
  const router = useRouter();

  useEffect(() => {
    fetch("/api/v1/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setFirstLogin(d?.session?.fl === true));
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (newPassword !== confirm) {
      setMsg({ text: "새 비밀번호가 서로 다릅니다.", ok: false });
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/v1/me/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: firstLogin ? undefined : currentPassword, newPassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMsg({ text: ERRORS[data.error] ?? "변경에 실패했습니다.", ok: false });
        return;
      }
      setCurrentPassword("");
      setNewPassword("");
      setConfirm("");
      if (firstLogin) {
        router.push(nextAfterFirstLogin());
        router.refresh();
        return;
      }
      setMsg({ text: "비밀번호를 변경했습니다.", ok: true });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="page-header">
        <div className="eyebrow">내 정보</div>
        <h1>비밀번호 변경</h1>
        <div className="desc">
          {firstLogin
            ? "초기 비밀번호로 로그인하셨습니다. 안전을 위해 새 비밀번호로 변경해주세요(8자 이상)."
            : "현재 비밀번호를 모른다면 로그아웃 후 로그인 화면의 “비밀번호를 잊으셨나요?”를 이용하세요."}
        </div>
      </div>
      <div className="card">
        <form onSubmit={onSubmit}>
          {!firstLogin && (
            <div className="field">
              <label>현재 비밀번호</label>
              <input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} required />
            </div>
          )}
          <div className="field">
            <label>새 비밀번호 (8자 이상)</label>
            <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} minLength={8} required />
          </div>
          <div className="field">
            <label>새 비밀번호 확인</label>
            <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} minLength={8} required />
          </div>
          <button type="submit" disabled={busy}>
            {busy ? "변경 중..." : "비밀번호 변경"}
          </button>
          {firstLogin && (
            <a
              href="#"
              style={{ marginLeft: 14 }}
              className="faint"
              onClick={(e) => {
                e.preventDefault();
                router.push(nextAfterFirstLogin());
              }}
            >
              나중에 변경
            </a>
          )}
        </form>
        {msg && <p className={msg.ok ? "muted" : "error"}>{msg.text}</p>}
      </div>
    </div>
  );
}
