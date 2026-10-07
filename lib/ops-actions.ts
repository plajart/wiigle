import "server-only";
import { Types } from "mongoose";
import { dbConnect } from "./mongodb";
import PointAccount from "./models/PointAccount";
import PointEvent from "./models/PointEvent";
import AuditLog from "./models/AuditLog";
import RedeemLock from "./models/RedeemLock";
import ImportHold from "./models/ImportHold";
import Store from "./models/Store";
import { ApiError } from "./rbac";
import { logPosTransfer } from "./points";
import { publishPointChange } from "./realtime";

// 본사 관리모드 "운영 점검·복구"의 조치들. 모두 본사(owner) 전용이며 감사로그에 남긴다.
// 원칙: 원장(PointEvent)은 지우거나 고치지 않는다 — 되돌리기·보정은 반대 내역을 새로 추가하고 원본과 서로 연결한다.
// 챔프 외 임의 포인트 변경 스위치(manualPointChangesEnabled)와는 별개다: 이 조치들은 운영 중 생긴 오류를 정정하는 용도이며 사유가 필수다.

const CREDIT_TYPES = new Set(["EARN", "VENDOR_EARN", "VENDOR_IMPORT", "GRANT", "USE_CANCEL"]); // 계좌에 더해진 내역
const DEBIT_TYPES = new Set(["REDEEM", "VENDOR_USE", "EARN_CANCEL"]); // 계좌에서 빠진 내역

function needReason(reason: unknown): string {
  const r = typeof reason === "string" ? reason.trim() : "";
  if (r.length < 2) throw new ApiError(400, "REASON_REQUIRED");
  return r.slice(0, 300);
}

async function companyIdOfStoreStrict(storeId: string): Promise<string> {
  const store = await Store.findById(storeId).select("companyId").lean();
  if (!store) throw new ApiError(404, "STORE_NOT_FOUND");
  return String(store.companyId);
}

/** 계좌에 delta 를 더한다(없으면 만든다). 되돌리기·보정은 이미 확정된 사실을 바로잡는 것이라 잔액이 음수가 되어도 막지 않는다. */
async function addToAccount(userId: string, companyId: string, storeId: string | null, delta: number) {
  const filter = storeId ? { userId, storeId, type: "STORE" as const } : { userId, storeId: null, type: "HQ" as const, companyId };
  return PointAccount.findOneAndUpdate(
    filter,
    { $setOnInsert: { userId, storeId, type: storeId ? "STORE" : "HQ", companyId }, $inc: { balance: delta } },
    { upsert: true, new: true }
  );
}

/** 포인트 내역 한 건을 되돌린다 — 반대 방향의 보정 내역을 추가하고 계좌 잔액을 맞춘다(같은 건은 한 번만). */
export async function reversePointEvent(eventId: string, reason: unknown, actorId: string) {
  await dbConnect();
  const why = needReason(reason);
  if (!Types.ObjectId.isValid(eventId)) throw new ApiError(400, "INVALID_EVENT_ID");
  const ev = await PointEvent.findById(eventId);
  if (!ev) throw new ApiError(404, "EVENT_NOT_FOUND");
  if (ev.reversedBy) throw new ApiError(409, "ALREADY_REVERSED");
  if (ev.reversalOf) throw new ApiError(400, "CANNOT_REVERSE_A_REVERSAL");
  if (ev.type === "TRANSFER_IN" || ev.type === "TRANSFER_OUT") throw new ApiError(400, "TRANSFER_REVERSAL_UNSUPPORTED");
  if (ev.status !== "CONFIRMED") throw new ApiError(400, "EVENT_NOT_CONFIRMED");

  let effect: number; // 이 내역이 계좌에 준 영향(+는 더해짐)
  if (CREDIT_TYPES.has(ev.type)) effect = ev.amount;
  else if (DEBIT_TYPES.has(ev.type)) effect = -ev.amount;
  else if (ev.type === "ADJUST") effect = ev.amount; // 보정은 부호가 있는 값
  else throw new ApiError(400, "UNSUPPORTED_TYPE");
  const delta = -effect;
  if (!Number.isFinite(delta) || delta === 0) throw new ApiError(400, "NOTHING_TO_REVERSE");

  const userId = String(ev.userId);
  const storeId = ev.storeId ? String(ev.storeId) : null;
  const companyId = ev.companyId ? String(ev.companyId) : storeId ? await companyIdOfStoreStrict(storeId) : "";
  if (!companyId) throw new ApiError(400, "COMPANY_UNKNOWN");

  // 반대 내역을 먼저 만든다 — reversalOf 의 고유 인덱스 덕분에 같은 내역을 동시에 여러 번 눌러도 한 번만 만들어진다(나머지는 중복 오류로 거부).
  // 그다음 원본에 표시하고 잔액을 맞춘다. 잔액 반영이 실패하면 반대 내역과 표시를 지워 원상 복구한다.
  const revId = new Types.ObjectId();
  const type = ev.type === "EARN" || ev.type === "VENDOR_EARN" ? "EARN_CANCEL" : ev.type === "REDEEM" || ev.type === "VENDOR_USE" ? "USE_CANCEL" : "ADJUST";
  const amount = type === "ADJUST" ? delta : Math.abs(delta);
  try {
    await PointEvent.create({
      _id: revId,
      userId,
      companyId,
      storeId,
      type,
      amount,
      status: "CONFIRMED",
      approvedBy: actorId,
      reason: `본사 되돌리기: ${why} (원본 내역 ${String(ev._id)}, ${ev.type} ${ev.amount})`,
      reversalOf: ev._id,
      occurredAt: new Date(),
      recordedAt: new Date(),
    });
  } catch (e) {
    if ((e as { code?: number }).code === 11000) throw new ApiError(409, "ALREADY_REVERSED");
    throw e;
  }
  try {
    await PointEvent.updateOne({ _id: ev._id }, { $set: { reversedBy: revId, reversedAt: new Date() } });
    const account = await addToAccount(userId, companyId, storeId, delta);
    await AuditLog.create({
      storeId,
      actorType: "HQ_ADMIN",
      actorId,
      action: "OPS_EVENT_REVERSED",
      meta: { eventId: String(ev._id), eventType: ev.type, eventAmount: ev.amount, delta, reason: why, userId, reversalId: String(revId), balanceAfter: account?.balance },
    });
    publishPointChange({ companyId, storeId: storeId ?? "", userId }, "REVERSAL");
    return { reversalId: String(revId), delta, balanceAfter: account?.balance ?? null };
  } catch (e) {
    await PointEvent.deleteOne({ _id: revId }).catch(() => {});
    await PointEvent.updateOne({ _id: ev._id, reversedBy: revId }, { $unset: { reversedBy: "", reversedAt: "" } }).catch(() => {});
    throw e;
  }
}

/** 계좌 잔액 보정(+/−) — 어떤 내역으로도 설명되지 않는 어긋남을 바로잡을 때. 사유 필수, 감사로그 기록. storeId 가 없으면 그 고객사의 통합포인트 계좌. */
export async function correctBalance(input: { userId: string; companyId: string; storeId: string | null; delta: unknown; reason: unknown; actorId: string }) {
  await dbConnect();
  const why = needReason(input.reason);
  const delta = Number(input.delta);
  if (!Number.isFinite(delta) || delta === 0 || Math.abs(delta) > 10_000_000) throw new ApiError(400, "INVALID_AMOUNT");
  if (!Types.ObjectId.isValid(input.userId) || !Types.ObjectId.isValid(input.companyId)) throw new ApiError(400, "INVALID_ID");
  if (input.storeId) {
    if (!Types.ObjectId.isValid(input.storeId)) throw new ApiError(400, "INVALID_ID");
    if ((await companyIdOfStoreStrict(input.storeId)) !== input.companyId) throw new ApiError(400, "STORE_COMPANY_MISMATCH");
  }
  const account = await addToAccount(input.userId, input.companyId, input.storeId, delta);
  await PointEvent.create({
    userId: input.userId,
    companyId: input.companyId,
    storeId: input.storeId,
    type: "ADJUST",
    amount: delta,
    status: "CONFIRMED",
    approvedBy: input.actorId,
    reason: `본사 보정: ${why}`,
    occurredAt: new Date(),
    recordedAt: new Date(),
  });
  await AuditLog.create({
    storeId: input.storeId,
    actorType: "HQ_ADMIN",
    actorId: input.actorId,
    action: "OPS_BALANCE_CORRECTED",
    meta: { userId: input.userId, companyId: input.companyId, storeId: input.storeId, delta, reason: why, balanceAfter: account?.balance },
  });
  publishPointChange({ companyId: input.companyId, storeId: input.storeId ?? "", userId: input.userId }, "ADJUST");
  return { balanceAfter: account?.balance ?? null };
}

/** 이 고객에 걸린 사용 조회 잠금을 모두 푼다(포스가 꺼지는 등으로 잠금이 남아 다른 포스에서 사용이 막힐 때). */
export async function releaseCustomerLocks(userId: string, actorId: string) {
  await dbConnect();
  if (!Types.ObjectId.isValid(userId)) throw new ApiError(400, "INVALID_ID");
  const r = await RedeemLock.deleteMany({ userId });
  await AuditLog.create({ storeId: null, actorType: "HQ_ADMIN", actorId, action: "OPS_LOCK_RELEASED", meta: { userId, deleted: r.deletedCount } });
  return { released: r.deletedCount };
}

/**
 * 포스 포인트 이전 보류 건 처리. approve: 서버에 더한다(초과분 또는 이번 포스기 잔액 전체) — 이후 같은 잔액이 다시 와도 이미 이전된 것으로 보고 포스 잔액을 0으로 정리한다.
 * dismiss: 서버에 더하지 않는다(다른 포스기와 같은 포인트의 복제로 판단 등) — 이후 같은 잔액이 다시 와도 이미 처리된 것으로 보고 포스 잔액만 0으로 정리한다.
 */
export async function resolveImportHold(holdId: string, decision: "approve" | "dismiss", note: unknown, actorId: string) {
  await dbConnect();
  if (!Types.ObjectId.isValid(holdId)) throw new ApiError(400, "INVALID_ID");
  const why = typeof note === "string" ? note.trim().slice(0, 300) : "";
  // 이중 클릭 방지 — 열린 건만 처리 상태로 바꿔 선점한다.
  const hold = await ImportHold.findOneAndUpdate(
    { _id: holdId, status: "OPEN" },
    { $set: { status: decision === "approve" ? "APPROVED" : "DISMISSED", resolvedBy: actorId, resolvedAt: new Date(), note: why } },
    { new: false }
  );
  if (!hold) throw new ApiError(409, "ALREADY_RESOLVED");
  const storeId = String(hold.storeId);
  const userId = String(hold.userId);
  const terminalId = String(hold.terminalId);

  if (decision === "dismiss") {
    await AuditLog.create({ storeId, actorType: "HQ_ADMIN", actorId, action: "OPS_IMPORT_HOLD_DISMISSED", meta: { holdId, kind: hold.kind, phone: hold.phone, balance: hold.balance, terminalId, note: why } });
    return { status: "DISMISSED" as const };
  }

  try {
    const companyId = hold.companyId ? String(hold.companyId) : await companyIdOfStoreStrict(storeId);
    await PointEvent.create({
      userId,
      companyId,
      storeId,
      terminalId,
      type: "VENDOR_IMPORT",
      amount: hold.amount,
      status: "CONFIRMED",
      vendorTxnId: `IMPORT-HOLD-${holdId}`,
      approvedBy: actorId,
      recordedAt: new Date(),
      reason: `본사 승인 포스 포인트 서버 이전 (${hold.kind === "STORE_REPLICA_SUSPECT" ? "다른 포스기와 중복 의심" : "이전 기록보다 포스 잔액이 많음"}, 포스기 ${terminalId})${why ? " — " + why : ""}`,
    });
    const account = await addToAccount(userId, companyId, storeId, hold.amount);
    await logPosTransfer({ storeId, terminalId, userId, phone: hold.phone, kind: "BULK_IMPORT", direction: "POS_TO_SERVER", amount: hold.amount, serverBalanceAfter: account?.balance, note: "본사 승인(이전 보류 해제)" });
    await AuditLog.create({ storeId, actorType: "HQ_ADMIN", actorId, action: "OPS_IMPORT_HOLD_APPROVED", meta: { holdId, kind: hold.kind, phone: hold.phone, balance: hold.balance, amount: hold.amount, terminalId, note: why } });
    publishPointChange({ companyId, storeId, userId }, "BULK_IMPORT");
    return { status: "APPROVED" as const, balanceAfter: account?.balance ?? null };
  } catch (e) {
    // 처리 중 실패 — 다시 처리할 수 있게 열린 상태로 되돌린다(중복 키 오류는 이미 승인된 건이므로 그대로 둔다).
    if ((e as { code?: number }).code !== 11000) await ImportHold.updateOne({ _id: holdId }, { $set: { status: "OPEN" }, $unset: { resolvedBy: "", resolvedAt: "" } }).catch(() => {});
    throw e;
  }
}

/**
 * 한 포스기가 서버로 이전한 초기 포인트(VENDOR_IMPORT)를 한꺼번에 되돌린다 — 이전이 잘못됐을 때(복제된 DB 를 중복 이전한 경우 등)의 복구용.
 * 아직 되돌리지 않은 이전 내역만 대상이다. 서버 쪽만 되돌리며 포스의 잔액은 바뀌지 않는다(포스는 이전 때 0으로 정리됐으므로, 필요하면 포스에서
 * 바탕화면 백업 파일로 복원: restore-bulk-import-backup.ps1). preview 로 대상 건수·금액을 먼저 확인한다.
 */
export async function previewTerminalImports(terminalId: string) {
  await dbConnect();
  if (!Types.ObjectId.isValid(terminalId)) throw new ApiError(400, "INVALID_ID");
  const events = await PointEvent.find({ terminalId, type: "VENDOR_IMPORT", reversedBy: { $exists: false }, reversalOf: { $exists: false }, status: "CONFIRMED" }).select("amount").lean();
  return { count: events.length, totalAmount: events.reduce((s, e) => s + (e.amount || 0), 0) };
}

export async function reverseTerminalImports(terminalId: string, reason: unknown, actorId: string) {
  await dbConnect();
  const why = needReason(reason);
  if (!Types.ObjectId.isValid(terminalId)) throw new ApiError(400, "INVALID_ID");
  const events = await PointEvent.find({ terminalId, type: "VENDOR_IMPORT", reversedBy: { $exists: false }, reversalOf: { $exists: false }, status: "CONFIRMED" }).select("_id amount").limit(5000).lean();
  let done = 0;
  let total = 0;
  const failed: string[] = [];
  for (const e of events) {
    try {
      await reversePointEvent(String(e._id), `포스기 초기 이전 일괄 되돌리기: ${why}`, actorId);
      done++;
      total += e.amount || 0;
    } catch (err) {
      failed.push(`${String(e._id)}:${(err as Error).message}`);
    }
  }
  await AuditLog.create({ storeId: null, actorType: "HQ_ADMIN", actorId, action: "OPS_TERMINAL_IMPORTS_REVERSED", meta: { terminalId, reason: why, done, total, failed: failed.slice(0, 20), failedCount: failed.length } });
  return { done, totalAmount: total, failed: failed.length };
}
