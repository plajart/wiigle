"use client";

import { useCallback, useEffect, useState } from "react";
import { useRealtime } from "../components/useRealtime";

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

const RENAME_ERRORS: Record<string, string> = {
  NAME_IN_USE: "이미 같은 이름의 포스기가 있습니다.",
  NAME_REQUIRED: "이름을 입력해 주세요.",
};

// 매장 대시보드의 "포스 단말기" 목록 — 상태 확인, 이름 변경, 대표 지정, 해지.
type StoreOpt = { _id: string; name: string; companyName: string };

export default function TerminalList({ storeId, role }: { storeId: string; role: string }) {
  const canMove = role === "owner" || role === "admin"; // 매장 관리자는 포스기를 옮길 수 없다
  const [moveFor, setMoveFor] = useState<string | null>(null);
  const [stores, setStores] = useState<StoreOpt[] | null>(null);
  const [targetStore, setTargetStore] = useState("");
  const [terminals, setTerminals] = useState<Terminal[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [detailFor, setDetailFor] = useState<string | null>(null);
  const [detail, setDetail] = useState<Activity[] | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/stores/${storeId}/pos-terminals`);
      const data = await res.json().catch(() => ({}));
      setTerminals(Array.isArray(data.terminals) ? data.terminals : []);
    } catch {
      setTerminals((prev) => prev ?? []);
    }
  }, [storeId]);

  useEffect(() => {
    load();
    const t = setInterval(load, 15000); // 온라인 상태 자동 갱신
    return () => clearInterval(t);
  }, [load]);
  useRealtime(load);

  async function revoke(terminalId: string) {
    if (!window.confirm("이 포스 단말기의 연결을 해지할까요? 해지 후에는 포스 프로그램을 다시 다운로드해 설치해야 합니다.")) return;
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

  async function rename(e: React.FormEvent, terminalId: string) {
    e.preventDefault();
    setMsg(null);
    const res = await fetch(`/api/v1/stores/${storeId}/pos-terminals/${terminalId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: editName }),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setMsg(RENAME_ERRORS[d.error] ?? "이름을 바꾸지 못했습니다. 잠시 후 다시 시도해 주세요.");
      return;
    }
    setEditingId(null);
    load();
  }

  async function openMove(terminalId: string) {
    setMsg(null);
    setMoveFor(terminalId);
    setTargetStore("");
    if (!stores) {
      const res = await fetch(`/api/v1/stores${role === "owner" ? "?all=1" : ""}`);
      const d = await res.json().catch(() => ({}));
      setStores(Array.isArray(d.stores) ? d.stores : []);
    }
  }

  async function doMove(terminalId: string) {
    const target = stores?.find((s) => s._id === targetStore);
    if (!target) return;
    if (!window.confirm(`이 포스기를 "${target.companyName} › ${target.name}" 매장으로 옮깁니다. 이후 이 포스기의 적립·사용은 그 매장에 기록됩니다. 진행할까요?`)) return;
    const res = await fetch(`/api/v1/stores/${storeId}/pos-terminals/${terminalId}/move`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetStoreId: targetStore }),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMsg(
        d.error === "PENDING_UNSENT"
          ? "서버로 아직 못 보낸 결제가 남아 있어 옮길 수 없습니다. 포스기의 인터넷 연결을 확인하고, 모두 반영된 뒤 다시 시도해 주세요."
          : d.error === "FORBIDDEN_STORE_SCOPE"
            ? "이 매장으로는 옮길 수 없습니다(자기 고객사 안의 매장만 가능)."
            : "옮기지 못했습니다. 잠시 후 다시 시도해 주세요."
      );
      return;
    }
    setMoveFor(null);
    load();
  }

  async function toggleDetail(terminalId: string) {
    if (detailFor === terminalId) {
      setDetailFor(null);
      return;
    }
    setDetailFor(terminalId);
    setDetail(null);
    const res = await fetch(`/api/v1/stores/${storeId}/pos-terminals/${terminalId}/recent-activity`);
    const data = await res.json().catch(() => ({}));
    setDetail(res.ok ? data.events : []);
  }

  const active = terminals?.filter((t) => t.status === "ACTIVE") ?? [];

  return (
    <div className="card">
      {terminals === null && <p className="muted">불러오는 중...</p>}
      {terminals && active.length === 0 && (
        <div className="empty-state">
          <div className="ic">◎</div>
          아직 등록된 포스 단말기가 없습니다. 왼쪽 메뉴의 "포스기 다운로드"에서 프로그램을 받아 설치하세요.
        </div>
      )}
      {active.map((t) => (
        <div key={t._id}>
          <div className="row">
            <span>
              {editingId === t._id ? (
                <form onSubmit={(e) => rename(e, t._id)} style={{ display: "flex", gap: 8 }}>
                  <input style={{ marginBottom: 0, maxWidth: 160 }} value={editName} onChange={(e) => setEditName(e.target.value)} required />
                  <button type="submit" className="sm">저장</button>
                  <button type="button" className="sm ghost" onClick={() => setEditingId(null)}>취소</button>
                </form>
              ) : (
                <span className="value">
                  {t.name} {t.isPrimary && <span className="badge" style={{ marginLeft: 6 }}>대표</span>}
                </span>
              )}
              <div className="faint" style={{ marginTop: 4 }}>
                등록 {new Date(t.registeredAt).toLocaleDateString("ko-KR")} ·{" "}
                {t.lastSeenAt ? `최근 응답 ${new Date(t.lastSeenAt).toLocaleTimeString("ko-KR")}` : "응답 기록 없음"}
              </div>
              {t.agentStatus && (t.agentStatus.pending > 0 || t.agentStatus.skippedNoPhone > 0 || t.agentStatus.lastError) && (
                <div className="error" style={{ marginTop: 4 }}>
                  {t.agentStatus.pending > 0 && <>서버에 아직 못 보낸 적립·사용 {t.agentStatus.pending}건 · </>}
                  {t.agentStatus.skippedNoPhone > 0 && <>전화번호가 없어 보류된 {t.agentStatus.skippedNoPhone}건 · </>}
                  {t.agentStatus.lastError && (
                    <>
                      최근 오류: {t.agentStatus.lastError}
                      {t.agentStatus.lastErrorAt ? ` (${new Date(t.agentStatus.lastErrorAt).toLocaleString("ko-KR")})` : ""}
                    </>
                  )}
                </div>
              )}
            </span>
            <span style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <span className={"badge " + (t.online ? "success" : "neutral")}>{t.online ? "가동중" : "오프라인"}</span>
              <button type="button" className="sm ghost" onClick={() => { setEditName(t.name); setEditingId(t._id); }}>
                이름 변경
              </button>
              {canMove && (
                <button type="button" className="sm ghost" onClick={() => openMove(t._id)}>
                  매장 이동
                </button>
              )}
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
          {moveFor === t._id && (
            <div style={{ padding: "0 4px 14px 4px", display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <select style={{ marginBottom: 0 }} value={targetStore} onChange={(e) => setTargetStore(e.target.value)}>
                <option value="">옮길 매장 선택</option>
                {(stores ?? [])
                  .filter((s) => s._id !== storeId)
                  .map((s) => (
                    <option key={s._id} value={s._id}>
                      {s.companyName} › {s.name}
                    </option>
                  ))}
              </select>
              <button type="button" className="sm" disabled={!targetStore} onClick={() => doMove(t._id)}>이동</button>
              <button type="button" className="sm ghost" onClick={() => setMoveFor(null)}>취소</button>
            </div>
          )}
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
      {msg && <p className="error">{msg}</p>}
    </div>
  );
}
