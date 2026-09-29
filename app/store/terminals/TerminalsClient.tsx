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
};

type Activity = { _id: string; type: string; isEarn: boolean; amount: number; occurredAt: string; cardNo: string | null };

type DiscoveredPeer = { ip: string; name: string };

const LOCAL_AGENT_BASE = "http://localhost:58787";

export default function TerminalsClient({ storeId }: { storeId: string }) {
  const [terminals, setTerminals] = useState<Terminal[] | null>(null);
  const [pairing, setPairing] = useState<{ code: string; expiresAt: number } | null>(null);
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  const [detailFor, setDetailFor] = useState<string | null>(null);
  const [detail, setDetail] = useState<Activity[] | null>(null);

  // 이 화면이 대표 포스기의 브라우저에서 열려 있으면, 그 컴퓨터의 에이전트(localhost)가
  // 같은 LAN에서 찾은 미등록 단말 목록을 보여준다. 다른 곳에서 열면 조용히 비어있는 채로 둔다.
  const [discovered, setDiscovered] = useState<DiscoveredPeer[] | null>(null);
  const [registeringIp, setRegisteringIp] = useState<string | null>(null);

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

  useEffect(() => {
    if (!pairing) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [pairing]);

  useEffect(() => {
    let stopped = false;
    async function poll() {
      try {
        const res = await fetch(`${LOCAL_AGENT_BASE}/discovered`, { signal: AbortSignal.timeout(2000) });
        const data = await res.json();
        if (!stopped) setDiscovered(data.isPrimary ? data.peers : null);
      } catch {
        if (!stopped) setDiscovered(null); // 이 컴퓨터에 에이전트가 없거나 대표가 아님 — 정상, 조용히 숨김
      }
    }
    poll();
    const t = setInterval(poll, 4000);
    return () => {
      stopped = true;
      clearInterval(t);
    };
  }, []);

  async function generateCode() {
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/stores/${storeId}/pos-terminals/pairing-code`, { method: "POST" });
      const data = await res.json();
      if (res.ok) setPairing({ code: data.code, expiresAt: Date.now() + data.expiresInSec * 1000 });
    } finally {
      setBusy(false);
    }
  }

  async function revoke(terminalId: string) {
    if (!window.confirm("이 POS 터미널의 연결을 해지할까요? 해지 후에는 다시 등록해야 합니다.")) return;
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

  async function registerPeer(ip: string) {
    setRegisteringIp(ip);
    try {
      await fetch(`${LOCAL_AGENT_BASE}/register-peer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ip }),
      });
      // 등록이 반영되기까지 잠깐 걸릴 수 있어 몇 초 뒤 목록을 새로고침
      setTimeout(load, 3000);
    } finally {
      setRegisteringIp(null);
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

  const remainSec = pairing ? Math.max(0, Math.round((pairing.expiresAt - now) / 1000)) : 0;

  return (
    <div>
      <div className="page-header">
        <div className="eyebrow">매장 관리자</div>
        <h1>POS 터미널 등록</h1>
        <div className="desc">매장의 첫 단말은 아래 등록 코드로 연결하세요 — 자동으로 대표 포스기가 됩니다.</div>
        <div className="desc">
          두 번째 단말부터는 코드를 입력할 필요 없이, 그 컴퓨터에 프로그램만 설치해 실행하면 잠시 뒤 아래
          &ldquo;발견된 포스기&rdquo;에 나타납니다 — <b>등록</b>만 눌러주세요.
        </div>
        <div className="desc">
          대표 포스기에서만 이 관리모드(지금 보시는 화면과 동일)로 바로가는 아이콘이 뜨고, 나머지 단말은 결제 시
          적립·사용만 가능합니다.
        </div>
        <div className="desc">
          <a href="/api/v1/pos-agent/download">포스 프로그램 다운로드</a> — 이 링크는 로그인한 매장·본사 관리자만
          받을 수 있습니다.
        </div>
      </div>

      <div className="card">
        <div className="card-title">새 POS 터미널 등록 (첫 단말용)</div>
        {!pairing && (
          <button type="button" onClick={generateCode} disabled={busy}>
            {busy ? "발급 중..." : "등록 코드 발급"}
          </button>
        )}
        {pairing && remainSec > 0 && (
          <div>
            <div className="point-hero" style={{ padding: 20, marginBottom: 10 }}>
              <div className="hero-label">등록 코드 (카운터 단말 프로그램에 입력)</div>
              <div className="hero-value" style={{ letterSpacing: "0.15em" }}>
                {pairing.code}
              </div>
              <div className="hero-sub">{remainSec}초 후 만료</div>
            </div>
            <button type="button" className="secondary sm" onClick={() => setPairing(null)}>
              닫기
            </button>
          </div>
        )}
        {pairing && remainSec === 0 && <p className="muted">코드가 만료되었습니다. 다시 발급해주세요.</p>}
      </div>

      {discovered !== null && (
        <div className="card">
          <div className="card-title">발견된 포스기 (같은 네트워크, 아직 미등록)</div>
          {discovered.length === 0 && <p className="faint" style={{ margin: 0 }}>아직 발견된 단말이 없습니다.</p>}
          {discovered.map((p) => (
            <div className="row" key={p.ip}>
              <span className="value">{p.name}</span>
              <button type="button" className="sm" disabled={registeringIp === p.ip} onClick={() => registerPeer(p.ip)}>
                {registeringIp === p.ip ? "등록 중..." : "등록"}
              </button>
            </div>
          ))}
        </div>
      )}

      <h2>등록된 POS 터미널</h2>
      <div className="card">
        {terminals === null && <p className="muted">불러오는 중...</p>}
        {terminals?.length === 0 && (
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
