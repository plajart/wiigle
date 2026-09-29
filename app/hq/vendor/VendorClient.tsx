"use client";

import { useEffect, useState } from "react";

type Store = { _id: string; name: string };

export default function VendorClient() {
  const [stores, setStores] = useState<Store[]>([]);
  const [vendorStoreId, setVendorStoreId] = useState("");
  const [vendorBaseUrl, setVendorBaseUrl] = useState("");
  const [vendorApiKey, setVendorApiKey] = useState("");
  const [vendorMsg, setVendorMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/v1/stores")
      .then((r) => r.json())
      .then((d) => setStores(d.stores ?? []));
  }, []);

  async function saveVendorConfig(e: React.FormEvent) {
    e.preventDefault();
    setVendorMsg(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/hq/stores/${vendorStoreId}/vendor-config`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseUrl: vendorBaseUrl, apiKey: vendorApiKey }),
      });
      const data = await res.json();
      setVendorMsg(res.ok ? { text: "저장되었습니다.", ok: true } : { text: `실패: ${data.error}`, ok: false });
      if (res.ok) {
        setVendorBaseUrl("");
        setVendorApiKey("");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="page-header">
        <div className="eyebrow">플랫폼 관리자</div>
        <h1>벤더 API 설정</h1>
        <div className="desc">매장 POS 단말의 연동 에이전트 접속 정보를 등록합니다.</div>
      </div>
      <div className="card">
        <form onSubmit={saveVendorConfig}>
          <div className="field">
            <label>매장</label>
            <select value={vendorStoreId} onChange={(e) => setVendorStoreId(e.target.value)} required>
              <option value="">선택하세요</option>
              {stores.map((s) => (
                <option key={s._id} value={s._id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Agent API 주소</label>
            <input value={vendorBaseUrl} onChange={(e) => setVendorBaseUrl(e.target.value)} placeholder="예: http://192.168.45.240:8787" required />
          </div>
          <div className="field">
            <label>API 키</label>
            <input value={vendorApiKey} onChange={(e) => setVendorApiKey(e.target.value)} required />
          </div>
          {vendorMsg && <p className={vendorMsg.ok ? "success-msg" : "error"}>{vendorMsg.text}</p>}
          <button type="submit" className="full" disabled={busy}>
            {busy ? "저장 중..." : "저장"}
          </button>
        </form>
      </div>
    </div>
  );
}
