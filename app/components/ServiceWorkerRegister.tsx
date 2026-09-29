"use client";

import { useEffect } from "react";

export default function ServiceWorkerRegister() {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // 설치 불가 환경(사파리 구버전 등)에서도 앱 자체 동작에는 지장 없음
      });
    }
  }, []);
  return null;
}
