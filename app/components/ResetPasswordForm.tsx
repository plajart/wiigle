"use client";

import { useState } from "react";

// 고객이 비밀번호를 잊었을 때, 대면 확인 후 초기 비밀번호로 되돌린다. 새 비밀번호는 여기에 표시되지 않는다.
export default function ResetPasswordForm() {
  const [phone, setPhone] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (!window.confirm("초기화하면 그 회원은 초기 비밀번호로 다시 로그인해야 합니다. 진행할까요?")) return;
    setLoading(true);
    try {
      const res = await fetch("/api/v1/customers/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) return void (window.location.href = "/login");
      if (!res.ok) {
        setMsg({ ok: false, text: data.error === "CUSTOMER_NOT_FOUND" ? "이 매장·고객사에서 이용한 고객을 찾을 수 없습니다." : "처리하지 못했습니다. 잠시 후 다시 시도해 주세요." });
        return;
      }
      setMsg({ ok: true, text: `${data.name} (${data.phone}) 님의 비밀번호를 초기화했습니다. 고객님께 로그인 화면의 "처음 로그인하시나요? 초기 비밀번호 확인"에서 비밀번호를 확인해 바로 로그인하도록 안내해 주세요.` });
      setPhone("");
    } catch {
      setMsg({ ok: false, text: "네트워크 오류입니다. 다시 시도해 주세요." });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="card">
      <div className="card-title">고객 비밀번호 초기화</div>
      <p className="faint" style={{ marginTop: 0 }}>비밀번호를 잊은 고객을 대면 확인한 뒤 전화번호로 초기화합니다. 새 비밀번호는 여기에 표시되지 않고, 고객이 로그인 화면에서 직접 확인합니다.</p>
      <form onSubmit={submit} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
        <input style={{ marginBottom: 0 }} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="01012345678" required />
        <button type="submit" disabled={loading}>{loading ? "처리 중..." : "비밀번호 초기화"}</button>
      </form>
      {msg && <p className={msg.ok ? "faint" : "error"} style={{ marginTop: 12, marginBottom: 0 }}>{msg.text}</p>}
    </div>
  );
}
