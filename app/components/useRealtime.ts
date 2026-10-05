"use client";

import { useEffect, useRef } from "react";

// 포인트 변화 신호(SSE)를 받으면 onChange를 부른다 — 짧은 시간에 여러 번 와도 한 번으로 묶는다.
// 연결이 끊기면 브라우저가 자동 재연결하고, 지원하지 않는 환경에서는 조용히 아무것도 하지 않는다(화면의 기존 새로고침이 보완).
export function useRealtime(onChange: () => void) {
  const cb = useRef(onChange);
  cb.current = onChange;
  useEffect(() => {
    if (typeof window === "undefined" || typeof EventSource === "undefined") return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const es = new EventSource("/api/v1/events");
    es.addEventListener("point", () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => cb.current(), 300);
    });
    return () => {
      if (timer) clearTimeout(timer);
      es.close();
    };
  }, []);
}
