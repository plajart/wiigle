"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function SignupForm() {
  const [step, setStep] = useState<"form" | "otp">("form");
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();
  const storeRef = searchParams.get("store"); // 매장 고정 QR 스티커로 들어온 경우

  async function onSignup(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/v1/auth/customer/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, name, password, storeRef }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "가입 실패");
        return;
      }
      setStep("otp");
    } finally {
      setLoading(false);
    }
  }

  async function onVerify(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/v1/auth/otp/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, code: otp }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "인증 실패");
        return;
      }
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

  if (step === "otp") {
    return (
      <div className="auth-shell">
        <div className="auth-card">
          <div className="auth-brand">
            <span className="dot" />
            포인트 관리
          </div>
          <h1>휴대폰 인증</h1>
          <p className="muted" style={{ marginBottom: 18 }}>
            {phone}로 인증번호를 보냈습니다.
          </p>
          <form onSubmit={onVerify}>
            <div className="field">
              <label>인증번호 6자리</label>
              <input value={otp} onChange={(e) => setOtp(e.target.value)} required />
            </div>
            {error && <div className="error">{error}</div>}
            <button type="submit" className="full" disabled={loading}>
              {loading ? "확인 중..." : "인증하고 가입 완료"}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <div className="auth-brand">
          <span className="dot" />
          포인트 관리
        </div>
        <h1>회원가입</h1>
        {storeRef && <p className="faint" style={{ marginBottom: 14 }}>매장에서 안내받아 오셨네요 — 가입 후 매장에서 카드를 연결해드립니다.</p>}
        <form onSubmit={onSignup}>
          <div className="field">
            <label>이름</label>
            <input value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div className="field">
            <label>휴대폰번호</label>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="01012345678" required />
          </div>
          <div className="field">
            <label>비밀번호</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
          </div>
          {error && <div className="error">{error}</div>}
          <button type="submit" className="full" disabled={loading}>
            {loading ? "처리 중..." : "가입하기"}
          </button>
        </form>
        <p className="auth-foot">
          이미 계정이 있다면 <a href="/login">로그인</a>
        </p>
      </div>
    </div>
  );
}

export default function SignupPage() {
  return (
    <Suspense fallback={<div className="auth-shell" />}>
      <SignupForm />
    </Suspense>
  );
}
