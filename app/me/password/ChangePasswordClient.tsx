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

export default function ChangePasswordClient() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [firstTime, setFirstTime] = useState(false); // 비밀번호를 아직 정하지 않고 들어온 경우
  const router = useRouter();

  useEffect(() => {
    fetch("/api/v1/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setFirstTime(d?.session?.pwUnset === true));
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
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMsg({ text: ERRORS[data.error] ?? "변경에 실패했습니다.", ok: false });
        return;
      }
      setCurrentPassword("");
      setNewPassword("");
      setConfirm("");
      if (firstTime) {
        router.push("/me");
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
        <h1>{firstTime ? "비밀번호 정하기" : "비밀번호 변경"}</h1>
        <div className="desc">
          {firstTime
            ? "처음 로그인하셨습니다. 앞으로 로그인할 때 사용할 비밀번호를 정해주세요(8자 이상)."
            : "현재 비밀번호를 모른다면 로그아웃 후 로그인 화면의 \u201c비밀번호를 잊으셨나요?\u201d를 이용하세요."}
        </div>
      </div>
      <div className="card">
        <form onSubmit={onSubmit}>
          {!firstTime && (
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
            {busy ? "저장 중..." : firstTime ? "비밀번호 정하기" : "비밀번호 변경"}
          </button>
        </form>
        {msg && <p className={msg.ok ? "muted" : "error"}>{msg.text}</p>}
      </div>
    </div>
  );
}
