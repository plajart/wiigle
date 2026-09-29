"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function SignupForm() {
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
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
        setError(
          data.error === "PHONE_ALREADY_USED"
            ? "이미 등록된 번호입니다. 매장에서 포인트가 적립된 적이 있다면 로그인 화면의 '처음 로그인하시나요? 초기 비밀번호 확인'을 이용하세요."
            : (data.error ?? "가입 실패")
        );
        return;
      }
      // 가입과 동시에 로그인된다 — 영수증 QR로 들어왔다면 카드 연결 화면으로, 아니면 내 포인트로.
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
        <h1>회원가입</h1>
        {storeRef && <p className="faint" style={{ marginBottom: 14 }}>매장에서 안내받아 오셨네요 — 가입하신 휴대폰번호로 매장에서 결제하시면 포인트가 적립됩니다.</p>}
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
