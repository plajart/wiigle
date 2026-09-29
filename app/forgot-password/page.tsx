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

function urlBase64ToUint8Array(b64: string): Uint8Array<ArrayBuffer> {
  const padded = (b64 + "=".repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

// 이 기기(앱)로 알림을 받도록 등록한다. 알림 허용을 눌러야 하므로 버튼 클릭 안에서 호출해야 한다.
// 결과: "on"=등록됨, "denied"=알림을 허용하지 않음, "unsupported"=이 기기·브라우저는 알림 미지원/미설정.
async function registerThisDevice(phone: string): Promise<"on" | "denied" | "unsupported"> {
  try {
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return "unsupported";
    const keyRes = await fetch("/api/v1/push/public-key");
    if (!keyRes.ok) return "unsupported";
    const { publicKey } = await keyRes.json();
    const permission = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
    if (permission !== "granted") return "denied";
    const reg = await navigator.serviceWorker.ready;
    const sub =
      (await reg.pushManager.getSubscription()) ??
      (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) }));
    const res = await fetch("/api/v1/auth/push/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone, subscription: sub.toJSON() }),
    });
    return res.ok ? "on" : "unsupported";
  } catch {
    return "unsupported";
  }
}

export default function ForgotPasswordPage() {
  const [step, setStep] = useState<"phone" | "reset">("phone");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [pushState, setPushState] = useState<"on" | "denied" | "unsupported" | null>(null);
  const router = useRouter();

  async function requestCode(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      // 먼저 이 기기를 알림 대상으로 등록(알림 허용 창이 뜰 수 있음) → 그 다음 인증번호 요청
      setPushState(await registerThisDevice(phone));
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
              가입한 휴대폰번호를 입력하고 &ldquo;인증번호 받기&rdquo;를 누른 뒤, 알림 허용을 선택하면 이 앱(기기)으로
              인증번호를 보내드립니다.
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
              {pushState === "on"
                ? "이 기기로 인증번호 알림을 보냈습니다(가입된 번호인 경우). 알림을 확인해 5분 안에 입력해주세요."
                : pushState === "denied"
                  ? "알림을 허용하지 않아 이 기기로는 받을 수 없습니다. 브라우저·앱 설정에서 알림을 허용한 뒤 인증번호를 다시 받아주세요."
                  : "이 기기에서는 앱 알림을 쓸 수 없습니다. 문자 발송이 설정된 경우에만 인증번호를 받을 수 있습니다."}
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
