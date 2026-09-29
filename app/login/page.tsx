"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function LoginForm() {
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();
  const justReset = searchParams.get("reset") === "1";
  // 로그인 뒤 돌아갈 화면(예: 대표 포스기 바로가기가 연 /store). 같은 사이트 안의 경로만 허용한다(외부 주소로 보내는 공격 방지).
  const nextParam = searchParams.get("next");
  const nextPath = nextParam && /^\/[A-Za-z0-9_\-\/]*$/.test(nextParam) && !nextParam.startsWith("//") ? nextParam : null;
  const [initialNotice, setInitialNotice] = useState<string | null>(null);

  // 매장에서 포인트가 적립되어 계정이 만들어진 손님은, 처음 로그인할 때 여기서 임의 초기 비밀번호를 확인한다.
  // 한 번 로그인에 성공하면 서버가 그 비밀번호를 지워서 이후에는 안내되지 않는다.
  async function showInitialPassword() {
    setError(null);
    setInitialNotice(null);
    if (phone.replace(/[^0-9]/g, "").length < 9) {
      setError("휴대폰번호를 먼저 입력해주세요.");
      return;
    }
    try {
      const res = await fetch("/api/v1/auth/initial-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error === "TOO_MANY_REQUESTS" ? "요청이 너무 많습니다. 잠시 후 다시 시도해주세요." : "확인하지 못했습니다.");
        return;
      }
      if (data.initialPassword) {
        setPassword(data.initialPassword);
        setInitialNotice(`초기 비밀번호는 ${data.initialPassword} 입니다. 아래 비밀번호 칸에 입력했으니 로그인한 뒤 비밀번호를 변경해주세요.`);
      } else {
        setInitialNotice("안내할 초기 비밀번호가 없습니다. 이미 로그인한 적이 있다면 비밀번호를 입력하거나 '비밀번호를 잊으셨나요?'를 이용해주세요.");
      }
    } catch {
      setError("확인하지 못했습니다.");
    }
  }

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
      // 초기 비밀번호로 처음 로그인한 경우에만 비밀번호 변경 안내 화면을 한 번 보여준다. 이때는 영수증 QR 연결
      // (pendingClaimToken)을 지우지 않고 남겨 두어, 안내 화면을 마친 뒤 그 화면으로 이어진다.
      let pendingClaim: string | null = null;
      try {
        pendingClaim = localStorage.getItem("pendingClaimToken");
        if (pendingClaim && !data.firstLogin) localStorage.removeItem("pendingClaimToken");
      } catch {
        // localStorage 접근 불가 시 그냥 /me로
      }
      router.push(data.firstLogin ? "/me/password" : pendingClaim ? `/claim/${pendingClaim}` : (nextPath ?? "/me"));
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
          {initialNotice && <div className="success-msg" style={{ marginBottom: 12 }}>{initialNotice}</div>}
          <p style={{ margin: "0 0 14px" }}>
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault();
                showInitialPassword();
              }}
            >
              처음 로그인하시나요? 초기 비밀번호 확인
            </a>
          </p>
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
          고객사·매장을 운영하신다면 <a href="/store-signup">고객사·매장 등록 신청</a>
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
