import "server-only";
import { Types } from "mongoose";
import AgentRollout from "./models/AgentRollout";
import PosTerminal from "./models/PosTerminal";
import Store from "./models/Store";
import Company from "./models/Company";
import AuditLog from "./models/AuditLog";
import { getAgentBundle } from "./agent-bundle";
import { publishPointChange } from "./realtime";
import { ApiError } from "./rbac";

const ONLINE_MS = 2 * 60 * 1000; // 2분 안에 하트비트가 있으면 켜져 있는 것으로 본다
const TURN_TIMEOUT_MS = 10 * 60 * 1000; // 한 대가 10분 넘게 끝내지 못하면 실패로 보고 다음으로 넘어간다
const BUSY_RETRY_MS = 3 * 60 * 1000; // 결제 중이라 미룬 포스기는 3분 뒤에 다시 순서가 온다

export async function currentRollout() {
  return AgentRollout.findOne().sort({ startedAt: -1 }).lean();
}

/** 본사: 지금 서버의 최신 버전으로 전체 순차 업데이트 시작. 이미 진행 중이면 409. */
export async function startRollout(actorId: string) {
  const running = await AgentRollout.findOne({ status: "RUNNING" }).lean();
  if (running) throw new ApiError(409, "ROLLOUT_ALREADY_RUNNING");
  const { version } = await getAgentBundle();
  const rollout = await AgentRollout.create({ targetVersion: version, startedBy: actorId });

  const terminals = await PosTerminal.find({ status: "ACTIVE" }).lean();
  const stores = await Store.find({ _id: { $in: [...new Set(terminals.map((t) => String(t.storeId)))] } }).select("name companyId").lean();
  const companies = await Company.find().select("name").lean();
  const storeOf = new Map(stores.map((s) => [String(s._id), s]));
  const companyName = new Map(companies.map((c) => [String(c._id), c.name]));
  // 순서: 고객사 이름 → 매장 이름 → 등록 순
  const sorted = [...terminals].sort((a, b) => {
    const sa = storeOf.get(String(a.storeId));
    const sb = storeOf.get(String(b.storeId));
    const ka = `${companyName.get(String(sa?.companyId)) ?? ""}\u0000${sa?.name ?? ""}`;
    const kb = `${companyName.get(String(sb?.companyId)) ?? ""}\u0000${sb?.name ?? ""}`;
    return ka.localeCompare(kb, "ko") || new Date(a.registeredAt).getTime() - new Date(b.registeredAt).getTime();
  });
  let order = 0;
  const now = new Date();
  for (const t of sorted) {
    order++;
    let status: "PENDING" | "DONE" | "MANUAL" = "PENDING";
    if (t.agentVersion === version) status = "DONE"; // 이미 최신
    else if (!t.agentCaps?.includes("update")) status = "MANUAL"; // 자동 업데이트를 모르는 옛 버전 — 한 번 직접 업데이트/재설치 필요
    await PosTerminal.updateOne(
      { _id: t._id },
      { $set: { agentUpdate: { rolloutId: rollout._id, status, order, ...(status === "DONE" ? { finishedAt: now } : {}) } } }
    );
  }
  await AuditLog.create({ storeId: null, actorType: "HQ_ADMIN", actorId, action: "AGENT_ROLLOUT_START", meta: { rolloutId: String(rollout._id), version, terminals: order } });
  await finishIfComplete(rollout._id); // 업데이트할 포스기가 하나도 없으면 바로 완료
  publishPointChange({}, "AGENT_UPDATE");
  return rollout;
}

export async function cancelRollout(actorId: string) {
  const r = await AgentRollout.findOneAndUpdate({ status: "RUNNING" }, { status: "CANCELLED", finishedAt: new Date(), currentTerminalId: null, currentSince: null }, { new: true });
  if (!r) throw new ApiError(404, "NO_RUNNING_ROLLOUT");
  await PosTerminal.updateMany({ "agentUpdate.rolloutId": r._id, "agentUpdate.status": { $in: ["PENDING", "UPDATING"] } }, { $set: { "agentUpdate.status": "FAILED", "agentUpdate.error": "본사가 업데이트를 중단함", "agentUpdate.finishedAt": new Date() } });
  await AuditLog.create({ storeId: null, actorType: "HQ_ADMIN", actorId, action: "AGENT_ROLLOUT_CANCEL", meta: { rolloutId: String(r._id) } });
  publishPointChange({}, "AGENT_UPDATE");
}

async function finishIfComplete(rolloutId: Types.ObjectId) {
  const open = await PosTerminal.countDocuments({ "agentUpdate.rolloutId": rolloutId, "agentUpdate.status": { $in: ["PENDING", "UPDATING"] } });
  if (open === 0) {
    const r = await AgentRollout.findOneAndUpdate({ _id: rolloutId, status: "RUNNING" }, { status: "DONE", finishedAt: new Date(), currentTerminalId: null, currentSince: null });
    if (r) publishPointChange({}, "AGENT_UPDATE");
  }
}

export type HeartbeatUpdateReport = { agentVersion?: string; caps?: string[]; updateStatus?: string; updateError?: string };

/**
 * 하트비트마다 호출 — 이 포스기가 지금 업데이트할 차례인지 정한다(한 번에 한 대씩, 순서대로).
 * 보고된 설치 버전이 목표와 같으면 완료 처리하고, 포스기가 "결제 중이라 못 함(BUSY)"/"실패(FAILED)"를 알려오면 반영한다.
 */
export async function rolloutDecision(terminalId: Types.ObjectId, report: HeartbeatUpdateReport): Promise<{ updateNow: boolean; targetVersion: string | null }> {
  const rollout = await AgentRollout.findOne({ status: "RUNNING" });
  if (!rollout) return { updateNow: false, targetVersion: null };
  const me = await PosTerminal.findById(terminalId);
  if (!me || !me.agentUpdate || String(me.agentUpdate.rolloutId) !== String(rollout._id)) return { updateNow: false, targetVersion: rollout.targetVersion };
  const now = new Date();
  const holdsLock = rollout.currentTerminalId && String(rollout.currentTerminalId) === String(me._id);
  const release = async () => {
    if (holdsLock) await AgentRollout.updateOne({ _id: rollout._id, currentTerminalId: me._id }, { currentTerminalId: null, currentSince: null });
  };

  // 완료: 설치된 버전이 목표와 같다
  if (me.agentUpdate.status !== "DONE" && report.agentVersion === rollout.targetVersion) {
    await PosTerminal.updateOne({ _id: me._id }, { $set: { "agentUpdate.status": "DONE", "agentUpdate.finishedAt": now }, $unset: { "agentUpdate.error": "" } });
    await release();
    await finishIfComplete(rollout._id);
    publishPointChange({}, "AGENT_UPDATE");
    return { updateNow: false, targetVersion: rollout.targetVersion };
  }
  if (me.agentUpdate.status === "DONE" || me.agentUpdate.status === "FAILED" || me.agentUpdate.status === "MANUAL") {
    // 수동 업데이트를 지원하게 된(또는 직접 업데이트한) 포스기가 다시 보고하면 대기 상태로 되돌린다
    if (me.agentUpdate.status === "MANUAL" && report.caps?.includes("update")) {
      await PosTerminal.updateOne({ _id: me._id }, { $set: { "agentUpdate.status": "PENDING" } });
    }
    return { updateNow: false, targetVersion: rollout.targetVersion };
  }

  // 포스기가 알려온 결과
  if (report.updateStatus === "FAILED") {
    await PosTerminal.updateOne({ _id: me._id }, { $set: { "agentUpdate.status": "FAILED", "agentUpdate.error": (report.updateError ?? "업데이트 실패").slice(0, 200), "agentUpdate.finishedAt": now } });
    await release();
    await finishIfComplete(rollout._id);
    publishPointChange({}, "AGENT_UPDATE");
    return { updateNow: false, targetVersion: rollout.targetVersion };
  }
  if (report.updateStatus === "BUSY") {
    await PosTerminal.updateOne({ _id: me._id }, { $set: { "agentUpdate.status": "PENDING", "agentUpdate.skipUntil": new Date(now.getTime() + BUSY_RETRY_MS) } });
    await release();
    return { updateNow: false, targetVersion: rollout.targetVersion };
  }

  // 순서 판단: 다른 포스기가 진행 중(잠금)이면 기다린다. 오래 걸린 포스기는 시간 초과로 실패 처리하고 넘어간다.
  if (rollout.currentTerminalId && !holdsLock) {
    const stale = rollout.currentSince && now.getTime() - new Date(rollout.currentSince).getTime() > TURN_TIMEOUT_MS;
    if (!stale) return { updateNow: false, targetVersion: rollout.targetVersion };
    await PosTerminal.updateOne({ _id: rollout.currentTerminalId, "agentUpdate.rolloutId": rollout._id, "agentUpdate.status": "UPDATING" }, { $set: { "agentUpdate.status": "FAILED", "agentUpdate.error": "시간 초과(10분)", "agentUpdate.finishedAt": now } });
    await AgentRollout.updateOne({ _id: rollout._id, currentTerminalId: rollout.currentTerminalId }, { currentTerminalId: null, currentSince: null });
  }
  if (holdsLock) {
    // 이미 내 차례였고 아직 끝나지 않았다 — 계속 업데이트하라고 다시 알려준다(시간 초과는 위에서 다른 포스기 하트비트가 처리)
    return { updateNow: true, targetVersion: rollout.targetVersion };
  }

  // 켜져 있고(2분 이내 응답) 아직 순서가 안 지난(skipUntil) 대기 포스기 중 가장 앞선 것이 나일 때만 잠금을 잡는다.
  const candidates = await PosTerminal.find({
    "agentUpdate.rolloutId": rollout._id,
    "agentUpdate.status": "PENDING",
    lastSeenAt: { $gte: new Date(now.getTime() - ONLINE_MS) },
    $or: [{ "agentUpdate.skipUntil": { $exists: false } }, { "agentUpdate.skipUntil": { $lt: now } }],
  })
    .sort({ "agentUpdate.order": 1 })
    .limit(1)
    .select("_id")
    .lean();
  if (!candidates.length || String(candidates[0]._id) !== String(me._id)) return { updateNow: false, targetVersion: rollout.targetVersion };

  const locked = await AgentRollout.findOneAndUpdate({ _id: rollout._id, currentTerminalId: null }, { currentTerminalId: me._id, currentSince: now });
  if (!locked) return { updateNow: false, targetVersion: rollout.targetVersion };
  await PosTerminal.updateOne({ _id: me._id }, { $set: { "agentUpdate.status": "UPDATING", "agentUpdate.startedAt": now }, $unset: { "agentUpdate.error": "" } });
  publishPointChange({}, "AGENT_UPDATE");
  return { updateNow: true, targetVersion: rollout.targetVersion };
}

export async function rolloutStatus() {
  const [{ version: serverVersion }, rollout] = await Promise.all([getAgentBundle(), currentRollout()]);
  const terminals = await PosTerminal.find({ status: "ACTIVE" }).lean();
  const stores = await Store.find({ _id: { $in: [...new Set(terminals.map((t) => String(t.storeId)))] } }).select("name companyId").lean();
  const companies = await Company.find().select("name").lean();
  const storeOf = new Map(stores.map((s) => [String(s._id), s]));
  const companyName = new Map(companies.map((c) => [String(c._id), c.name]));
  const now = Date.now();
  const rows = terminals.map((t) => {
    const s = storeOf.get(String(t.storeId));
    const inThis = rollout && t.agentUpdate && String(t.agentUpdate.rolloutId) === String(rollout._id);
    return {
      terminalId: String(t._id),
      companyName: companyName.get(String(s?.companyId)) ?? "",
      storeName: s?.name ?? "",
      name: t.name,
      online: !!t.lastSeenAt && now - new Date(t.lastSeenAt).getTime() < ONLINE_MS,
      agentVersion: t.agentVersion ?? null,
      canAutoUpdate: !!t.agentCaps?.includes("update"),
      upToDate: t.agentVersion === serverVersion,
      state: inThis ? t.agentUpdate!.status : t.agentVersion === serverVersion ? "DONE" : "IDLE",
      error: inThis ? t.agentUpdate!.error ?? null : null,
      finishedAt: inThis ? t.agentUpdate!.finishedAt ?? null : null,
      order: inThis ? t.agentUpdate!.order : 0,
    };
  });
  rows.sort((a, b) => a.companyName.localeCompare(b.companyName, "ko") || a.storeName.localeCompare(b.storeName, "ko") || a.name.localeCompare(b.name));
  const counts = { total: rows.length, upToDate: rows.filter((r) => r.upToDate).length, updating: rows.filter((r) => r.state === "UPDATING").length, pending: rows.filter((r) => r.state === "PENDING").length, failed: rows.filter((r) => r.state === "FAILED").length, manual: rows.filter((r) => r.state === "MANUAL").length };
  return {
    serverVersion,
    rollout: rollout ? { _id: String(rollout._id), targetVersion: rollout.targetVersion, status: rollout.status, startedAt: rollout.startedAt, finishedAt: rollout.finishedAt ?? null } : null,
    counts,
    terminals: rows,
  };
}
