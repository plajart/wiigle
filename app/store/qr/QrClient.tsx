"use client";

import { useEffect, useState } from "react";

type QrInfo = { signupUrl: string; qrDataUrl: string };

export default function QrClient({ storeId }: { storeId: string }) {
  const [qr, setQr] = useState<QrInfo | null>(null);

  useEffect(() => {
    fetch(`/api/v1/stores/${storeId}/signup-qr`)
      .then((r) => r.json())
      .then(setQr);
  }, [storeId]);

  return (
    <div>
      <div className="page-header">
        <div className="eyebrow">매장 관리자</div>
        <h1>가입 안내 QR</h1>
        <div className="desc">카운터나 테이블에 붙여두면, 손님이 스캔해서 바로 회원가입할 수 있습니다. 카드 연결은 가입 후 매장에서 별도로 진행합니다.</div>
      </div>

      <div className="card" style={{ textAlign: "center" }}>
        {!qr && <p className="muted">불러오는 중...</p>}
        {qr && (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qr.qrDataUrl} alt="가입 안내 QR" width={260} height={260} style={{ borderRadius: 12 }} />
            <p className="faint" style={{ marginTop: 14, wordBreak: "break-all" }}>{qr.signupUrl}</p>
            <div className="btn-row" style={{ maxWidth: 280, margin: "16px auto 0" }}>
              <a href={qr.qrDataUrl} download="가입안내-QR.png">
                <button type="button" className="secondary full">이미지로 저장</button>
              </a>
              <button type="button" className="full" onClick={() => window.print()}>
                인쇄하기
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
