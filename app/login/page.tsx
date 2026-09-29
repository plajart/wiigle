"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function LoginForm() {
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const justReset = useSearchParams().get("reset") === "1";

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
      // 영수증 QR로 들어왔다가 로그인한 경우엔 카드 연결을 마저 진행하도록 그 화면으로 돌려보낸다.
      let pendingClaim: string | null = null;
      try {
        pendingClaim = localStorage.getItem("pendingClaimToken");
        if (pendingClaim) localStorage.removeItem("pendingClaimToken");
      } catch {
        // localStorage 접근 불가 시 그냥 /me로
      }
      router.push(pendingClaim ? `/claim/${pendingClaim}` : "/me");
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <div className="auth-brand">
          <span className="dot" />
          포인트 관리
        </div>
        <h1>로그인</h1>
        {justReset && <p className="muted" style={{ marginBottom: 14 }}>비밀번호를 변경했습니다. 새 비밀번호로 로그인해주세요.</p>}
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
        <p className="auth-foot">
          <a href="/forgot-password">비밀번호를 잊으셨나요?</a>
          <br />
          고객 계정이 없다면 <a href="/signup">가입하기</a>
          <br />
          매장을 운영하신다면 <a href="/store-signup">매장 등록 신청</a>
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="auth-shell" />}>
      <LoginForm />
    </Suspense>
  );
}
