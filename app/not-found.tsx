// 없는 주소로 들어와도 안내 화면을 보여준다.
export default function NotFound() {
  return (
    <div className="auth-shell">
      <div className="auth-card">
        <div className="auth-brand">
          <span className="dot" />
          포인트 관리
        </div>
        <h1>페이지를 찾을 수 없습니다</h1>
        <p className="muted" style={{ marginBottom: 18 }}>주소가 바뀌었거나 없는 페이지입니다.</p>
        <p className="auth-foot">
          <a href="/">처음 화면으로</a>
        </p>
      </div>
    </div>
  );
}
