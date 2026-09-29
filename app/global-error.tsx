"use client";

// 최상위 레이아웃 자체에서 오류가 났을 때의 마지막 안전망(자체 html/body가 필요하다).
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="ko">
      <body style={{ fontFamily: "system-ui, sans-serif", padding: 32 }}>
        <h1>잠시 문제가 생겼습니다</h1>
        <p>잠시 후 다시 시도해주세요.</p>
        <button type="button" onClick={reset} style={{ padding: "10px 18px" }}>
          다시 시도
        </button>
      </body>
    </html>
  );
}
