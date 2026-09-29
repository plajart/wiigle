"use client";

import { useEffect, useState, useCallback } from "react";

type Version = { versionCode: number; versionName: string; changelog: string; createdAt: string };

export default function AppReleasesClient() {
  const [versions, setVersions] = useState<Version[] | null>(null);
  const [versionName, setVersionName] = useState("");
  const [changelog, setChangelog] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/v1/owner/app-versions");
    const data = await res.json();
    setVersions(res.ok ? data.versions : []);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function upload(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    setBusy(true);
    setMessage(null);
    try {
      const form = new FormData();
      form.append("apk", file);
      form.append("versionName", versionName);
      form.append("changelog", changelog);
      const res = await fetch("/api/v1/owner/app-versions", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) {
        setMessage(`업로드 실패: ${data.error}`);
        return;
      }
      setMessage(`${data.versionName} 버전이 등록되어 바로 최신 버전이 되었습니다.`);
      setVersionName("");
      setChangelog("");
      setFile(null);
      await load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="page-header">
        <div className="eyebrow">플랫폼 관리자</div>
        <h1>고객앱 버전 관리</h1>
        <div className="desc">
          앱이 보여주는 내용(화면·기능)은 이 웹사이트 자체라 항상 실시간으로 최신입니다. 여기서 올리는 건
          앱의 껍데기(아이콘·패키지 등)뿐이라, 화면·기능을 바꾸는 보통의 개발에는 새로 올릴 필요가 없습니다.
          껍데기 자체를 바꿔야 할 때만(아이콘 교체 등) 새 파일을 올리세요. 올리면 곧바로 최신 버전이 되고,
          이미 설치된 앱은 열 때마다 새 버전이 있다는 안내를 받습니다(설치는 사용자가 직접 진행).
        </div>
        <div className="desc">
          <a href="/api/v1/pos-agent/download">포스 프로그램 다운로드</a> (본사·매장 관리자 전용)
        </div>
      </div>

      <div className="card">
        <div className="card-title">새 버전 업로드</div>
        <form onSubmit={upload}>
          <label>버전 이름 (예: 1.1.0)</label>
          <input value={versionName} onChange={(e) => setVersionName(e.target.value)} required />
          <label>변경 내용(선택)</label>
          <input value={changelog} onChange={(e) => setChangelog(e.target.value)} />
          <label>APK 파일</label>
          <input type="file" accept=".apk" onChange={(e) => setFile(e.target.files?.[0] ?? null)} required />
          <button type="submit" className="full" disabled={busy} style={{ marginTop: 12 }}>
            {busy ? "업로드 중..." : "업로드"}
          </button>
        </form>
        {message && <p className={message.startsWith("업로드 실패") ? "error" : "success-msg"} style={{ marginTop: 10 }}>{message}</p>}
      </div>

      <h2>업로드 내역</h2>
      <div className="card">
        {versions === null && <p className="muted">불러오는 중...</p>}
        {versions?.length === 0 && <div className="empty-state">아직 올린 버전이 없습니다</div>}
        {versions?.map((v, i) => (
          <div className="row" key={v.versionCode}>
            <span>
              <span className="value">
                {v.versionName} {i === 0 && <span className="badge success" style={{ marginLeft: 6 }}>최신</span>}
              </span>
              {v.changelog && <div className="faint" style={{ marginTop: 4 }}>{v.changelog}</div>}
            </span>
            <span className="faint">{new Date(v.createdAt).toLocaleString("ko-KR")}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
