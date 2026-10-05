"use client";

import { useCallback, useEffect, useState } from "react";
import { useRealtime } from "../../components/useRealtime";

type Row = {
  terminalId: string;
  companyName: string;
  storeName: string;
  name: string;
  online: boolean;
  agentVersion: string | null;
  canAutoUpdate: boolean;
  upToDate: boolean;
  state: string;
  error: string | null;
};
type Status = {
  serverVersion: string;
  rollout: { targetVersion: string; status: string; startedAt: string; finishedAt: string | null } | null;
  counts: { total: number; upToDate: number; updating: number; pending: number; failed: number; manual: number };
  terminals: Row[];
};

const STATE_LABEL: Record<string, { text: string; cls: string }> = {
  IDLE: { text: "대기 전", cls: "neutral" },
  PENDING: { text: "순서 대기", cls: "neutral" },
  UPDATING: { text: "업데이트 중", cls: "gold" },
  DONE: { text: "최신", cls: "success" },
  FAILED: { text: "실패", cls: "danger" },
  MANUAL: { text: "직접 업데이트 필요", cls: "danger" },
};

export default function AgentUpdateClient() {
  const [data, setData] = useState<Status | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/owner/agent-update");
      const d = await res.json().catch(() => null);
      if (res.ok && d) setData(d);
    } catch {
      // 다음 새로고침 때 다시
    }
  }, []);
  useEffect(() => {
    load();
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, [load]);
  useRealtime(load);

  async function act(action: "start" | "cancel") {
    const text =
      action === "start"
        ? "서버의 최신 프로그램으로 모든 고객사·매장의 포스기를 한 대씩 순서대로 업데이트합니다. 결제 중인 포스기는 미뤘다가 나중에 업데이트합니다. 시작할까요?"
        : "진행 중인 업데이트를 중단합니다(이미 끝난 포스기는 그대로입니다). 중단할까요?";
    if (!window.confirm(text)) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/v1/owner/agent-update", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) setMsg(d.error === "ROLLOUT_ALREADY_RUNNING" ? "이미 업데이트가 진행 중입니다." : "처리하지 못했습니다. 잠시 후 다시 시도해 주세요.");
      await load();
    } finally {
      setBusy(false);
    }
  }

  const running = data?.rollout?.status === "RUNNING";
  const c = data?.counts;
  let lastGroup = "";

  return (
    <div>
      <div className="page-header">
        <div className="eyebrow">본사 관리모드</div>
        <h1>포스 프로그램 업데이트</h1>
        <div className="desc">
          서버에 새 버전 파일을 올린 뒤 아래 버튼을 누르면 <b>모든 고객사·매장의 포스기</b>를 한 대씩 순서대로 업데이트합니다. 켜져 있는 포스기만 진행하며,
          꺼져 있거나 결제 중인 포스기는 나중에 순서가 다시 옵니다. 포스기의 트레이 메뉴 "업데이트 확인"으로 직접 업데이트하는 방법도 그대로 쓸 수 있습니다.
        </div>
      </div>

      <div className="card">
        {!data && <p className="muted">불러오는 중...</p>}
        {data && (
          <>
            <div className="row">
              <span className="label">서버 최신 버전</span>
              <span className="value">{data.serverVersion}</span>
            </div>
            <div className="row">
              <span className="label">진행 상태</span>
              <span className="value">
                {!data.rollout ? "아직 시작한 적 없음" : running ? "진행 중" : data.rollout.status === "DONE" ? "완료" : "중단됨"}
                {data.rollout && <span className="faint"> · 시작 {new Date(data.rollout.startedAt).toLocaleString("ko-KR")}{data.rollout.finishedAt ? ` · 종료 ${new Date(data.rollout.finishedAt).toLocaleString("ko-KR")}` : ""}</span>}
              </span>
            </div>
            {c && (
              <div className="row">
                <span className="label">포스기 {c.total}대</span>
                <span className="value">
                  최신 {c.upToDate} · 업데이트 중 {c.updating} · 순서 대기 {c.pending} · 실패 {c.failed} · 직접 업데이트 필요 {c.manual}
                </span>
              </div>
            )}
            <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
              <button type="button" disabled={busy || running} onClick={() => act("start")}>
                전체 업데이트 시작
              </button>
              {running && (
                <button type="button" className="ghost" disabled={busy} onClick={() => act("cancel")}>
                  중단
                </button>
              )}
            </div>
            {msg && <p className="error">{msg}</p>}
          </>
        )}
      </div>

      {data && (
        <div className="card">
          {data.terminals.length === 0 && <p className="faint" style={{ margin: 0 }}>등록된 포스기가 없습니다.</p>}
          {data.terminals.map((t) => {
            const group = `${t.companyName} › ${t.storeName}`;
            const header = group !== lastGroup;
            lastGroup = group;
            const st = STATE_LABEL[t.state] ?? { text: t.state, cls: "neutral" };
            return (
              <div key={t.terminalId}>
                {header && <div className="card-title" style={{ marginTop: 8 }}>{group}</div>}
                <div className="row">
                  <span>
                    <span className="value">{t.name}</span> <span className={"badge " + (t.online ? "success" : "neutral")}>{t.online ? "켜짐" : "꺼짐"}</span>
                    <div className="faint" style={{ marginTop: 4 }}>
                      설치 버전 {t.agentVersion ?? "알 수 없음"}
                      {!t.canAutoUpdate ? " · 자동 업데이트 미지원(옛 버전)" : ""}
                      {t.error ? ` · ${t.error}` : ""}
                    </div>
                  </span>
                  <span className={"badge " + st.cls}>{t.upToDate ? "최신" : st.text}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
