"use client";

import { useEffect, useState } from "react";

type Session = { sub: string; name: string; role: string; companyAdminOf?: string; storeManagerOf?: string } | null;

export default function NavBar() {
  const [session, setSession] = useState<Session>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch("/api/v1/me")
      .then((r) => (r.ok ? r.json() : { session: null }))
      .then((d) => setSession(d.session))
      .finally(() => setLoaded(true));
  }, []);

  // hq/store/customer 영역은 각자 사이드바 셸에 브랜드/로그아웃이 있으므로, 로그인 상태에선 상단바를 숨겨 화면을 단순하게 유지한다.
  if (!loaded || session) return null;

  return (
    <nav className="topnav">
      <a href="/" className="brand">
        <span className="dot" />
        포인트 관리
      </a>
      <div style={{ display: "flex", gap: 16 }}>
        <a href="/login">로그인</a>
        <a href="/signup">회원가입</a>
      </div>
    </nav>
  );
}
