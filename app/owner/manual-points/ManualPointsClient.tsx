"use client";

import { useCallback, useEffect, useState } from "react";

export default function ManualPointsClient() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/owner/manual-points");
      const d = await res.json().catch(() => null);
      if (res.ok && d) setEnabled(d.enabled === true);
    } catch {
      // 다음에 다시
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  async function toggle() {
    const next = !enabled;
    const text = next
      ? "챔프(포스) 결제 외의 임의 포인트 변경을 켭니다.\n\n켜면 매장 관리모드의 'POS 결제 터미널'(수동 적립·사용)과 고객사 관리모드의 '통합포인트 관리'(지급·조정)가 보이고 사용할 수 있습니다. 포스 잔액과 어긋나 중복·누락이 생길 수 있으니 필요한 정정 작업이 끝나면 바로 끄세요. 켤까요?"
      : "임의 포인트 변경을 끕니다. 수동 적립·사용과 통합포인트 지급·조정 메뉴가 사라지고 사용할 수 없게 됩니다. 끌까요?";
    if (!window.confirm(text)) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/v1/owner/manual-points", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: next }) });
      if (!res.ok) setMsg("변경하지 못했습니다. 잠시 후 다시 시도해 주세요.");
      await load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="page-header">
        <div className="eyebrow">본사 관리모드</div>
        <h1>임의 포인트 변경 설정</h1>
        <div className="desc">
          포인트는 챔프(포스) 결제의 적립·사용·취소와 포스 잔액의 서버 이전으로만 바뀌는 것이 원칙입니다. 웹에서 직접 적립·사용하거나 통합포인트를
          지급·조정하는 기능은 기본으로 꺼져 있고, 오류 정정처럼 꼭 필요할 때만 여기서 켭니다. 켜고 끄는 기록은 감사로그에 남습니다.
        </div>
      </div>
      <div className="card">
        {enabled === null ? (
          <p className="muted">불러오는 중...</p>
        ) : (
          <div className="row">
            <span>
              <span className="value">챔프 외 임의 포인트 변경</span>
              <div className="faint" style={{ marginTop: 4 }}>웹 수동 적립·사용(POS 결제 터미널), 통합포인트 지급·조정</div>
            </span>
            <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span className={"badge " + (enabled ? "danger" : "success")}>{enabled ? "켜짐(허용 중)" : "꺼짐(막힘)"}</span>
              <button type="button" className={enabled ? "" : "ghost"} disabled={busy} onClick={toggle}>
                {enabled ? "끄기" : "켜기"}
              </button>
            </span>
          </div>
        )}
        {msg && <p className="error">{msg}</p>}
      </div>
    </div>
  );
}
