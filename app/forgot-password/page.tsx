"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const ERRORS: Record<string, string> = {
  INVALID_OR_EXPIRED_CODE: "인증번호가 맞지 않거나 만료되었습니다. 다시 받아주세요.",
  PASSWORD_TOO_SHORT: "비밀번호는 8자 이상이어야 합니다.",
  PASSWORD_TOO_LONG: "비밀번호가 너무 깁니다.",
  TOO_MANY_REQUESTS: "요청이 너무 많습니다. 잠시 후 다시 시도해주세요.",
  PHONE_REQUIRED: "휴대폰번호를 확인해주세요.",
};

export default function ForgotPasswordPage() {
  const [step, setStep] = useState<"phone" | "reset">("phone");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function requestCode(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/v1/auth/password/forgot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(ERRORS[data.error] ?? "요청에 실패했습니다.");
        return;
      }
      setStep("reset");
    } finally {
      setLoading(false);
    }
  }

  async function resetPassword(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (newPassword !== confirm) {
      setError("새 비밀번호가 서로 다릅니다.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/v1/auth/password/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, code, newPassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(ERRORS[data.error] ?? "변경에 실패했습니다.");
        return;
      }
      router.push("/login?reset=1");
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
        <h1>비밀번호 찾기</h1>
        {step === "phone" ? (
          <form onSubmit={requestCode}>
            <p className="muted" style={{ marginBottom: 18 }}>
              가입한 휴대폰번호로 인증번호를 문자로 보내드립니다.
            </p>
            <div className="field">
              <label>휴대폰번호</label>
              <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="01012345678" required />
            </div>
            {error && <div className="error">{error}</div>}
            <button type="submit" className="full" disabled={loading}>
              {loading ? "보내는 중..." : "인증번호 받기"}
            </button>
          </form>
        ) : (
          <form onSubmit={resetPassword}>
            <p className="muted" style={{ marginBottom: 18 }}>
              {phone}로 인증번호를 보냈습니다(가입된 번호인 경우). 5분 안에 입력해주세요.
            </p>
            <div className="field">
              <label>인증번호 6자리</label>
              <input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" required />
            </div>
            <div className="field">
              <label>새 비밀번호 (8자 이상)</label>
              <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} minLength={8} required />
            </div>
            <div className="field">
              <label>새 비밀번호 확인</label>
              <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} minLength={8} required />
            </div>
            {error && <div className="error">{error}</div>}
            <button type="submit" className="full" disabled={loading}>
              {loading ? "변경 중..." : "비밀번호 변경"}
            </button>
            <p className="auth-foot">
              <a
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  setStep("phone");
                  setError(null);
                }}
              >
                인증번호 다시 받기
              </a>
            </p>
          </form>
        )}
        <p className="auth-foot">
          <a href="/login">로그인으로 돌아가기</a>
        </p>
      </div>
    </div>
  );
}
