"use client";

// 화면을 그리다 예기치 않은 오류가 나도 빈 화면이나 개발자용 오류 문구 대신 안내와 "다시 시도"를 보여준다.
export default function GlobalRouteError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="auth-shell">
      <div className="auth-card">
        <div className="auth-brand">
          <span className="dot" />
          포인트 관리
        </div>
        <h1>잠시 문제가 생겼습니다</h1>
        <p className="muted" style={{ marginBottom: 18 }}>
          화면을 불러오는 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요. 계속되면 매장이나 관리자에게 알려주세요.
        </p>
        <button type="button" className="full" onClick={reset}>
          다시 시도
        </button>
        <p className="auth-foot">
          <a href="/">처음 화면으로</a>
        </p>
      </div>
    </div>
  );
}
