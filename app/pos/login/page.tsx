"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export default function PosLoginPage() {
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [blockedNotice, setBlockedNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const router = useRouter();

  useEffect(() => {
    fetch("/api/v1/me")
      .then((r) => (r.ok ? r.json() : { session: null }))
      .then(async (d) => {
        const session = d.session;
        if (!session) return;
        if (session.storeManagerOf) {
          router.replace("/pos");
          return;
        }
        // 매장 관리 권한이 없는 계정으로 접속 시도 → 세션 즉시 종료(차단)
        await fetch("/api/v1/auth/logout", { method: "POST" });
        setBlockedNotice("이 화면은 매장 관리 권한이 있는 계정 전용입니다. 세션을 종료했습니다.");
      })
      .finally(() => setChecking(false));
  }, [router]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/v1/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "로그인 실패");
        return;
      }
      if (!data.storeManagerOf) {
        await fetch("/api/v1/auth/logout", { method: "POST" });
        setError("매장 관리 권한이 있는 계정으로만 접속할 수 있습니다.");
        return;
      }
      router.push("/pos");
    } finally {
      setLoading(false);
    }
  }

  if (checking) return <p className="muted" style={{ textAlign: "center", marginTop: 60 }}>확인 중...</p>;

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <div className="auth-brand">
          <span className="dot" />
          포인트 관리
        </div>
        <h1>POS 터미널 로그인</h1>
        <p className="muted" style={{ marginBottom: 18 }}>매장 관리 권한이 있는 계정 전용입니다.</p>
        {blockedNotice && <p className="error">{blockedNotice}</p>}
        <form onSubmit={onSubmit}>
          <div className="field">
            <label>휴대폰번호</label>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="01012345678" required />
          </div>
          <div className="field">
            <label>비밀번호</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>
          {error && <div className="error">{error}</div>}
          <button type="submit" className="full" disabled={loading}>
            {loading ? "로그인 중..." : "로그인"}
          </button>
        </form>
      </div>
    </div>
  );
}
