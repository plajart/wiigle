"use client";

import { useEffect, useState, useCallback } from "react";

type Terminal = {
  _id: string;
  name: string;
  status: "ACTIVE" | "REVOKED";
  registeredAt: string;
  lastSeenAt: string | null;
  online: boolean;
  isPrimary: boolean;
  agentStatus?: { pending: number; skippedNoPhone: number; lastError?: string | null; lastErrorAt?: string | null } | null;
};

type Activity = { _id: string; type: string; isEarn: boolean; amount: number; occurredAt: string; cardNo: string | null };

export default function TerminalsClient({ storeId }: { storeId: string }) {
  const [terminals, setTerminals] = useState<Terminal[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [detailFor, setDetailFor] = useState<string | null>(null);
  const [detail, setDetail] = useState<Activity[] | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/v1/stores/${storeId}/pos-terminals`);
    const data = await res.json();
    setTerminals(data.terminals ?? []);
  }, [storeId]);

  useEffect(() => {
    load();
    const t = setInterval(load, 15000); // 온라인 상태 자동 갱신
    return () => clearInterval(t);
  }, [load]);

  async function revoke(terminalId: string) {
    if (!window.confirm("이 POS 터미널의 연결을 해지할까요? 해지 후에는 포스 프로그램을 다시 다운로드해 설치해야 합니다.")) return;
    await fetch(`/api/v1/stores/${storeId}/pos-terminals/${terminalId}`, { method: "DELETE" });
    load();
  }

  async function setPrimary(terminalId: string) {
    setBusy(true);
    try {
      await fetch(`/api/v1/stores/${storeId}/pos-terminals`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ terminalId }),
      });
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function toggleDetail(terminalId: string) {
    if (detailFor === terminalId) {
      setDetailFor(null);
      return;
    }
    setDetailFor(terminalId);
    setDetail(null);
    const res = await fetch(`/api/v1/stores/${storeId}/pos-terminals/${terminalId}/recent-activity`);
    const data = await res.json();
    setDetail(res.ok ? data.events : []);
  }

  return (
    <div>
      <div className="page-header">
        <div className="eyebrow">매장 관리자</div>
        <h1>포스기 다운로드</h1>
        <div className="desc">
          포스기로 쓸 카운터 PC의 브라우저에서 이 화면을 열어 아래 버튼으로 프로그램을 받고, 압축을 풀어{" "}
          <b>start.bat</b>만 실행하세요. 인증코드 입력 없이 설치와 등록이 자동으로 끝나고, 설치된 프로그램에 이 매장의
          포스기 목록이 바로 표시됩니다.
        </div>
        <div className="desc">
          매장에 처음 설치한 PC는 자동으로 <b>대표 포스기</b>가 됩니다 — 대표 포스기에만 이 관리모드로 바로가는 아이콘이
          생기고, 나머지 단말은 결제 시 적립·사용만 가능합니다. 포스기를 더 추가하려면 그 PC에서 다시 다운로드해
          설치하세요.
        </div>
        <div className="desc">
          받은 압축파일에는 이 매장에 등록할 수 있는 1회용 설치 정보가 들어 있습니다(24시간 유효). 다른 사람에게
          전달하지 마세요.
        </div>
      </div>

      <div className="card">
        <div className="card-title">포스 프로그램</div>
        <button
          type="button"
          onClick={() => window.location.assign(`/api/v1/pos-agent/download?storeId=${encodeURIComponent(storeId)}`)}
        >
          포스기 다운로드
        </button>
      </div>

      <h2>등록된 POS 터미널</h2>
      <div className="card">
        {terminals === null && <p className="muted">불러오는 중...</p>}
        {terminals?.filter((t) => t.status === "ACTIVE").length === 0 && (
          <div className="empty-state">
            <div className="ic">◎</div>
            아직 등록된 POS 터미널이 없습니다
          </div>
        )}
        {terminals
          ?.filter((t) => t.status === "ACTIVE")
          .map((t) => (
            <div key={t._id}>
              <div className="row">
                <span>
                  <span className="value">
                    {t.name} {t.isPrimary && <span className="badge" style={{ marginLeft: 6 }}>대표</span>}
                  </span>
                  <div className="faint" style={{ marginTop: 4 }}>
                    등록 {new Date(t.registeredAt).toLocaleDateString("ko-KR")} ·{" "}
                    {t.lastSeenAt ? `최근 응답 ${new Date(t.lastSeenAt).toLocaleTimeString("ko-KR")}` : "응답 기록 없음"}
                  </div>
                  {t.agentStatus && (t.agentStatus.pending > 0 || t.agentStatus.skippedNoPhone > 0 || t.agentStatus.lastError) && (
                    <div className="error" style={{ marginTop: 4 }}>
                      {t.agentStatus.pending > 0 && <>서버에 아직 못 보낸 적립·사용 {t.agentStatus.pending}건 · </>}
                      {t.agentStatus.skippedNoPhone > 0 && <>전화번호가 없어 보류된 {t.agentStatus.skippedNoPhone}건 · </>}
                      {t.agentStatus.lastError && <>최근 오류: {t.agentStatus.lastError}{t.agentStatus.lastErrorAt ? ` (${new Date(t.agentStatus.lastErrorAt).toLocaleString("ko-KR")})` : ""}</>}
                    </div>
                  )}
                </span>
                <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span className={"badge " + (t.online ? "success" : "neutral")}>{t.online ? "가동중" : "오프라인"}</span>
                  <button type="button" className="sm ghost" onClick={() => toggleDetail(t._id)}>
                    {detailFor === t._id ? "닫기" : "상세보기"}
                  </button>
                  {!t.isPrimary && (
                    <button type="button" className="sm ghost" disabled={busy} onClick={() => setPrimary(t._id)}>
                      대표로 지정
                    </button>
                  )}
                  <button type="button" className="sm ghost" onClick={() => revoke(t._id)}>
                    해지
                  </button>
                </span>
              </div>
              {detailFor === t._id && (
                <div style={{ padding: "0 4px 14px 4px" }}>
                  {detail === null && <p className="muted">불러오는 중...</p>}
                  {detail?.length === 0 && <p className="faint" style={{ margin: 0 }}>이 단말의 최근 내역이 없습니다.</p>}
                  {detail?.map((d) => (
                    <div className="row" key={d._id} style={{ paddingLeft: 12 }}>
                      <span>
                        <span className={"badge " + (d.isEarn ? "success" : "neutral")}>{d.isEarn ? "적립" : "사용"}</span>{" "}
                        <span className="value">{d.amount.toLocaleString()}원</span>
                      </span>
                      <span className="faint">
                        {new Date(d.occurredAt).toLocaleString("ko-KR")}
                        {d.cardNo ? ` · 카드 ${d.cardNo}` : ""}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
      </div>
    </div>
  );
}
