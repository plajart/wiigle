"use client";

import { useEffect, useState, use as usePromise } from "react";
import { useRouter } from "next/navigation";

export default function ClaimPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = usePromise(params);
  const router = useRouter();
  const [storeName, setStoreName] = useState<string | null>(null);
  const [status, setStatus] = useState<"checking" | "invalid" | "need-auth" | "redeeming" | "done" | "error">(
    "checking"
  );
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    async function run() {
      const infoRes = await fetch(`/api/v1/claim-tokens/${token}`);
      if (!infoRes.ok) {
        setStatus("invalid");
        return;
      }
      const info = await infoRes.json();
      setStoreName(info.storeName);

      const meRes = await fetch("/api/v1/me");
      if (!meRes.ok) {
        setStatus("need-auth");
        return;
      }

      setStatus("redeeming");
      const redeemRes = await fetch(`/api/v1/claim-tokens/${token}/redeem`, { method: "POST" });
      const redeemData = await redeemRes.json();
      if (!redeemRes.ok) {
        setErrorMsg(redeemData.error ?? "연결 실패");
        setStatus("error");
        return;
      }
      setStatus("done");
    }
    run();
  }, [token]);

  function goAuth(dest: "login" | "signup") {
    try {
      localStorage.setItem("pendingClaimToken", token);
    } catch {
      // 개인정보 보호 모드 등으로 localStorage 접근 불가해도 아래 링크는 그대로 동작
    }
    router.push(`/${dest}`);
  }

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <div className="auth-brand">
          <span className="dot" />
          포인트 관리
        </div>
        <h1>회원카드 연결</h1>

        {status === "checking" && <p className="muted">확인 중...</p>}

        {status === "invalid" && (
          <p className="error">이 QR은 이미 사용되었거나 유효 시간이 지났습니다. 매장에 다시 요청해주세요.</p>
        )}

        {status === "need-auth" && (
          <>
            <p className="muted" style={{ marginBottom: 18 }}>
              {storeName ? `"${storeName}"` : "이 매장"}에서 방금 결제하신 카드를 계정에 연결합니다. 로그인하거나
              회원가입하면 자동으로 연결됩니다.
            </p>
            <button type="button" className="full" onClick={() => goAuth("login")} style={{ marginBottom: 10 }}>
              로그인하고 연결하기
            </button>
            <button type="button" className="full secondary" onClick={() => goAuth("signup")}>
              회원가입하고 연결하기
            </button>
          </>
        )}

        {status === "redeeming" && <p className="muted">카드를 연결하는 중...</p>}

        {status === "done" && (
          <>
            <p className="success-msg">
              {storeName ? `"${storeName}"` : "매장"} 카드가 계정에 연결되었습니다. 다음 방문부터는 카드만 스캔해도
              바로 인식됩니다.
            </p>
            <button type="button" className="full" onClick={() => router.push("/me")}>
              내 포인트 보러가기
            </button>
          </>
        )}

        {status === "error" && <p className="error">{errorMsg}</p>}
      </div>
    </div>
  );
}
