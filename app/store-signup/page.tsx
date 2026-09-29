"use client";

import { useState } from "react";

export default function StoreSignupPage() {
  const [type, setType] = useState<"NEW_COMPANY" | "ADD_STORE">("NEW_COMPANY");
  const [companyName, setCompanyName] = useState("");
  const [storeName, setStoreName] = useState("");
  const [franchiseCode, setFranchiseCode] = useState("");
  const [applicantName, setApplicantName] = useState("");
  const [applicantPhone, setApplicantPhone] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/v1/store-applications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, companyName, storeName, franchiseCode, applicantName, applicantPhone, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        const msg =
          data.error === "PHONE_ALREADY_USED"
            ? "이미 가입된 휴대폰번호입니다."
            : data.error === "APPLICATION_ALREADY_PENDING"
              ? "이미 심사 대기 중인 신청이 있습니다."
              : data.error === "PASSWORD_TOO_SHORT"
                ? "비밀번호는 8자 이상이어야 합니다."
                : data.error === "TOO_MANY_REQUESTS"
                  ? "신청이 너무 많습니다. 잠시 후 다시 시도해주세요."
                  : (data.error ?? "신청 실패");
        setError(msg);
        return;
      }
      setDone(true);
    } finally {
      setLoading(false);
    }
  }

  if (done) {
    return (
      <div className="auth-shell">
        <div className="auth-card">
          <div className="auth-brand">
            <span className="dot" />
            포인트 관리
          </div>
          <h1>신청 완료</h1>
          <p className="muted">
            등록 신청이 접수되었습니다. 검토 후 승인되면 입력하신 휴대폰번호와 비밀번호로 매장 관리자 화면에 로그인할 수
            있습니다. 승인 여부는 별도로 알려드리지 않으니, 며칠 뒤 로그인해 확인해주세요.
          </p>
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
        <h1>고객사·매장 등록 신청</h1>
        <form onSubmit={onSubmit}>
          <div className="field">
            <label>신청 종류</label>
            <select value={type} onChange={(e) => setType(e.target.value as "NEW_COMPANY" | "ADD_STORE")}>
              <option value="NEW_COMPANY">새 고객사와 첫 매장 등록</option>
              <option value="ADD_STORE">이미 등록된 고객사에 매장 추가</option>
            </select>
          </div>
          <div className="field">
            <label>{type === "ADD_STORE" ? "소속 고객사 이름" : "고객사(회사) 이름"}</label>
            <input value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="예: 더파티" required />
          </div>
          <div className="field">
            <label>매장명</label>
            <input value={storeName} onChange={(e) => setStoreName(e.target.value)} placeholder="예: 더파티 시청점" required />
          </div>
          <div className="field">
            <label>프랜차이즈 코드 (선택)</label>
            <input value={franchiseCode} onChange={(e) => setFranchiseCode(e.target.value)} />
          </div>
          <div className="field">
            <label>신청자(매장 관리자) 이름</label>
            <input value={applicantName} onChange={(e) => setApplicantName(e.target.value)} required />
          </div>
          <div className="field">
            <label>휴대폰번호</label>
            <input value={applicantPhone} onChange={(e) => setApplicantPhone(e.target.value)} placeholder="01012345678" required />
          </div>
          <div className="field">
            <label>비밀번호</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} required />
          </div>
          {error && <div className="error">{error}</div>}
          <button type="submit" className="full" disabled={loading}>
            {loading ? "제출 중..." : "등록 신청"}
          </button>
        </form>
        <p className="auth-foot">
          승인 후 이 번호와 비밀번호로 <a href="/login">로그인</a>할 수 있습니다
        </p>
      </div>
    </div>
  );
}
