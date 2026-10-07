import "server-only";
import { Types } from "mongoose";
import PointAccount from "./models/PointAccount";
import PointEvent from "./models/PointEvent";
import AuditLog from "./models/AuditLog";
import Store from "./models/Store";
import Company from "./models/Company";
import User from "./models/User";
import VendorImportRecord from "./models/VendorImportRecord";
import RedeemLock from "./models/RedeemLock";
import ImportHold from "./models/ImportHold";
import PosTransferLog, { type PosTransferKind } from "./models/PosTransferLog";
import PosTerminal from "./models/PosTerminal";
import { publishPointChange } from "./realtime";
import { ApiError } from "./rbac";

/**
 * 이 프로젝트는 MongoDB standalone(레플리카셋 아님) 위에서 동작하므로 멀티도큐먼트
 * 트랜잭션(session.startTransaction)을 쓰지 않는다. 대신 각 잔액 변경은
 * `balance >= amount` 조건이 걸린 findOneAndUpdate($inc)로 단일 문서 단위 원자성만
 * 보장한다. 두 계좌 사이(차감 성공 후 적립 전) 프로세스가 죽는 등 극단적 상황의
 * 정합성 복구는 AuditLog/PointEvent 이력을 근거로 수동 처리한다.
 * 운영 규모가 커지면 MongoDB 레플리카셋 전환 + 트랜잭션 적용을 권장.
 */

/**
 * "이 포스기 로컬 DB의 이 고객 레거시 잔액을 가져온 적이 있는지"를 포스기 단위로
 * 확인·표시한다(true = 처음이라 지금 가져와도 됨). 매장 단위 계좌 존재 여부로 판단하지
 * 않는 이유는 위 VendorImportRecord 설명 참고 — 영업 중에 포스기를 한 대씩 순서대로
 * 초기화해도(다른 포스기는 이미 실적립 중이어도) 안전하게 동작하려면 반드시 이 단위여야 함.
 */
async function claimVendorImport(
  storeId: string,
  terminalId: string,
  userId: string,
  amount: number,
  source: "LAZY" | "BULK"
): Promise<boolean> {
  try {
    await VendorImportRecord.create({ storeId, terminalId, userId, amount, source });
    return true;
  } catch (e) {
    if ((e as { code?: number }).code === 11000) return false; // 이 포스기에서는 이미 가져옴
    throw e;
  }
}

/**
 * 이 매장이 속한 고객사. 통합포인트는 고객사 단위로 운영되므로(같은 고객사의 매장끼리만 포인트를 합쳐 쓴다),
 * 원장에 손대는 모든 경로가 먼저 이 값을 구한다.
 */
async function companyIdOfStore(storeId: string): Promise<string> {
  const store = await Store.findById(storeId).select("companyId").lean();
  if (!store) throw new ApiError(404, "STORE_NOT_FOUND");
  const companyId = String(store.companyId);
  return String(store.companyId);
}

// STORE 계좌는 (고객, 매장)으로, HQ(통합포인트) 계좌는 (고객, 고객사)로 하나씩 만든다.
async function getOrCreateAccount(userId: string, storeId: string | null, type: "STORE" | "HQ", companyId: string) {
  const filter = type === "HQ" ? { userId, storeId: null, type, companyId } : { userId, storeId, type };
  // 같은 계좌를 처음 만드는 요청이 동시에 두 개 오면 유니크 인덱스 충돌(11000)이 날 수 있다 — 한 번 더 조회하면 이미 만들어져 있다.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await PointAccount.findOneAndUpdate(
        filter,
        { $setOnInsert: { userId, storeId, type, companyId, balance: 0 } },
        { upsert: true, new: true }
      );
    } catch (e) {
      if ((e as { code?: number }).code !== 11000 || attempt === 2) throw e;
    }
  }
  throw new ApiError(500, "ACCOUNT_CREATE_FAILED");
}

async function atomicDebit(accountId: Types.ObjectId, amount: number) {
  const updated = await PointAccount.findOneAndUpdate(
    { _id: accountId, balance: { $gte: amount } },
    { $inc: { balance: -amount } },
    { new: true }
  );
  return updated; // null이면 잔액 부족
}

async function atomicCredit(accountId: Types.ObjectId, amount: number) {
  return PointAccount.findByIdAndUpdate(accountId, { $inc: { balance: amount } }, { new: true });
}

export type CompanyPointSummary = {
  companyId: string;
  companyName: string;
  hq: number; // 통합포인트(고객사가 지급한 분)
  stores: { storeId: string; storeName: string; balance: number }[];
  total: number; // 이 고객사 안에서 쓸 수 있는 통합 잔액
};

/** 고객의 포인트를 **고객사별로** 묶어서 돌려준다 — 고객사가 다르면 잔액을 합치지 않는다. */
/** 본사가 "고객 웹 조회"를 꺼 둔 고객사 id 목록. */
export async function closedCompanyIds(): Promise<string[]> {
  const rows = await Company.find({ customerWebEnabled: false }).select("_id").lean();
  return rows.map((c) => String(c._id));
}

/** 고객 본인 웹 화면용 — 조회를 닫은 고객사는 제외한다(고객사 화면용 getCompanyPointSummary는 그대로 전부 본다). */
export async function getMyOpenPointSummary(userId: string) {
  const [all, closed] = await Promise.all([getMyPointSummary(userId), closedCompanyIds()]);
  const closedSet = new Set(closed);
  const open = all.companies.filter((c) => !closedSet.has(c.companyId));
  return { companies: open, hiddenCompanies: all.companies.length - open.length };
}

export async function getMyPointSummary(userId: string): Promise<{ companies: CompanyPointSummary[] }> {
  const accounts = await PointAccount.find({ userId }).populate("storeId", "name").lean();
  const byCompany = new Map<string, CompanyPointSummary>();
  for (const a of accounts) {
    const cid = String(a.companyId);
    let g = byCompany.get(cid);
    if (!g) {
      g = { companyId: cid, companyName: "", hq: 0, stores: [], total: 0 };
      byCompany.set(cid, g);
    }
    if (a.type === "HQ") g.hq += a.balance;
    else {
      g.stores.push({
        storeId: String((a.storeId as unknown as { _id?: unknown })?._id ?? a.storeId),
        storeName: (a.storeId as unknown as { name?: string })?.name ?? "알 수 없음",
        balance: a.balance,
      });
    }
    g.total += a.balance;
  }
  const names = await Company.find({ _id: { $in: [...byCompany.keys()] } }).select("name").lean();
  for (const c of names) {
    const g = byCompany.get(String(c._id));
    if (g) g.companyName = c.name;
  }
  return { companies: [...byCompany.values()].sort((x, y) => x.companyName.localeCompare(y.companyName, "ko")) };
}

/** 한 고객사 안에서의 잔액(통합포인트 + 그 고객사 매장들) — 매장·고객사 화면용. 계좌가 없으면 0. */
export async function getCompanyPointSummary(userId: string, companyId: string): Promise<CompanyPointSummary> {
  const all = await getMyPointSummary(userId);
  const found = all.companies.find((c) => c.companyId === String(companyId));
  if (found) return found;
  const company = await Company.findById(companyId).select("name").lean();
  return { companyId: String(companyId), companyName: company?.name ?? "", hq: 0, stores: [], total: 0 };
}

/** 이 고객이 이 고객사에서 이용한 적이 있는가(계좌 또는 내역) — 고객사 운영자의 고객 조회 범위 판단용. */
export async function hasCompanyRelation(userId: string, companyId: string): Promise<boolean> {
  if (await PointAccount.exists({ userId, companyId })) return true;
  return !!(await PointEvent.exists({ userId, companyId }));
}

export async function getMyPointHistory(userId: string, companyId?: string, opts?: { onlyOpen?: boolean }) {
  const filter: Record<string, unknown> = { userId };
  if (companyId) filter.companyId = companyId;
  else if (opts?.onlyOpen) {
    const closed = await closedCompanyIds();
    if (closed.length) filter.companyId = { $nin: closed };
  }
  return PointEvent.find(filter)
    .sort({ occurredAt: -1 })
    .limit(200)
    .populate("storeId", "name")
    .populate("companyId", "name")
    .lean();
}

/**
 * 고객: 결제 예정 매장으로 포인트 이체. 매장이 POS 연동 동의에서
 * "통합포인트·타매장 포인트 사용 허용"(accept_transfer) 스코프를 켜둔 경우에만
 * 허용되며, 별도 승인 절차 없이 즉시 반영된다(매장 단위 사전 동의로 승인을 대체).
 */
export async function transferPoints(
  customerId: string,
  targetStoreId: string,
  sourceType: "STORE" | "HQ",
  sourceStoreId: string | null,
  amount: number
) {
  if (amount <= 0) throw new ApiError(400, "INVALID_AMOUNT");
  const targetStore = await Store.findById(targetStoreId);
  if (!targetStore) throw new ApiError(404, "STORE_NOT_FOUND");
  const companyId = String(targetStore.companyId);
  // 통합포인트는 고객사 단위 — 다른 고객사 매장의 포인트를 옮겨 올 수 없다.
  if (sourceType === "STORE") {
    if (!sourceStoreId) throw new ApiError(400, "SOURCE_STORE_REQUIRED");
    if ((await companyIdOfStore(sourceStoreId)) !== companyId) throw new ApiError(403, "DIFFERENT_COMPANY");
  }
  if (!targetStore.posIntegration.scopes.includes("accept_transfer")) {
    throw new ApiError(403, "TRANSFER_NOT_ACCEPTED");
  }

  const sourceAccount = await getOrCreateAccount(
    customerId,
    sourceType === "STORE" ? sourceStoreId : null,
    sourceType,
    companyId
  );
  const debited = await atomicDebit(sourceAccount._id, amount);
  if (!debited) throw new ApiError(400, "INSUFFICIENT_BALANCE");

  const targetAccount = await getOrCreateAccount(customerId, targetStoreId, "STORE", companyId);
  await atomicCredit(targetAccount._id, amount);

  await PointEvent.create({
    userId: customerId,
    companyId,
    storeId: targetStoreId,
    sourceType,
    sourceStoreId: sourceType === "STORE" ? sourceStoreId : null,
    type: "TRANSFER_OUT",
    amount,
    status: "CONFIRMED",
  });
  const event = await PointEvent.create({
    userId: customerId,
    companyId,
    storeId: targetStoreId,
    type: "TRANSFER_IN",
    amount,
    status: "CONFIRMED",
  });

  await AuditLog.create({
    storeId: targetStoreId,
    actorType: "CUSTOMER",
    actorId: customerId,
    action: "TRANSFER_EXECUTE",
    meta: { amount, sourceType, sourceStoreId },
  });

  return event;
}

export async function grantHqPoints(customerId: string, companyId: string, amount: number, reason: string, actorId: string) {
  if (amount <= 0) throw new ApiError(400, "INVALID_AMOUNT");
  const account = await getOrCreateAccount(customerId, null, "HQ", companyId);
  await atomicCredit(account._id, amount);
  await PointEvent.create({
    userId: customerId,
      companyId,
    storeId: null,
    type: "GRANT",
    amount,
    status: "CONFIRMED",
    approvedBy: actorId,
    reason,
  });
  await AuditLog.create({ storeId: null, actorType: "HQ_ADMIN", actorId, action: "HQ_GRANT", meta: { customerId, companyId, amount, reason } });
}

export async function adjustHqPoints(customerId: string, companyId: string, delta: number, reason: string, actorId: string) {
  if (delta === 0) throw new ApiError(400, "INVALID_AMOUNT");
  const account = await getOrCreateAccount(customerId, null, "HQ", companyId);
  if (delta < 0) {
    const debited = await atomicDebit(account._id, -delta);
    if (!debited) throw new ApiError(400, "INSUFFICIENT_BALANCE");
  } else {
    await atomicCredit(account._id, delta);
  }
  await PointEvent.create({
    userId: customerId,
      companyId,
    storeId: null,
    type: "ADJUST",
    amount: delta,
    status: "CONFIRMED",
    approvedBy: actorId,
    reason,
  });
  await AuditLog.create({ storeId: null, actorType: "HQ_ADMIN", actorId, action: "HQ_ADJUST", meta: { customerId, companyId, delta, reason } });
}

/**
 * 매장 포인트만으로 부족하면 통합포인트 → 같은 고객사의 타매장 포인트 순서로 자동 차감한다.
 * posCheckout(우리 앱 화면에서 계산원이 직접 입력)과 applyVendorEvents(벤더 POS
 * 결제화면에서 이미 일어난 사용을 사후 동기화로 반영)가 이 로직을 공유한다 —
 * "누가 어떤 화면에서 차감을 트리거했든 잔액 차감 우선순위는 동일해야 한다".
 * 잔액 부족 시 throw하지 않고 null을 돌려준다: 실시간 결제(posCheckout)는 그 자리에서
 * 막아야 하지만, 사후 동기화(applyVendorEvents)는 이미 벤더 쪽에서 확정된 사실을
 * 반영하는 것뿐이라 거부할 수 없다 — 호출부에서 각자 다르게 처리한다.
 */
async function debitAvailable(customerId: string, storeId: string, amount: number) {
  const companyId = await companyIdOfStore(storeId);
  const storeAccount = await getOrCreateAccount(customerId, storeId, "STORE", companyId);
  const hqAccount = await getOrCreateAccount(customerId, null, "HQ", companyId);
  const otherStoreAccounts = await PointAccount.find({
    userId: customerId,
    type: "STORE",
    companyId, // 다른 고객사 매장의 포인트는 절대 쓰지 않는다
    storeId: { $ne: new Types.ObjectId(storeId) },
    balance: { $gt: 0 },
  });

  const available = storeAccount.balance + hqAccount.balance + otherStoreAccounts.reduce((s, a) => s + a.balance, 0);
  if (available < amount) return null;

  const breakdown: { source: string; amount: number }[] = [];
  let remaining = amount;

  const fromStore = Math.min(remaining, storeAccount.balance);
  if (fromStore > 0) {
    await atomicDebit(storeAccount._id, fromStore);
    remaining -= fromStore;
    breakdown.push({ source: "STORE_SELF", amount: fromStore });
  }

  if (remaining > 0) {
    const fromHq = Math.min(remaining, hqAccount.balance);
    if (fromHq > 0) {
      await atomicDebit(hqAccount._id, fromHq);
      remaining -= fromHq;
      breakdown.push({ source: "HQ", amount: fromHq });
    }
  }

  for (const acc of otherStoreAccounts) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, acc.balance);
    if (take > 0) {
      await atomicDebit(acc._id, take);
      remaining -= take;
      breakdown.push({ source: `STORE:${acc.storeId}`, amount: take });
    }
  }

  return breakdown;
}

/** 이 고객이 이 매장 결제에 지금 당장 쓸 수 있는 총액(같은 고객사의 매장+통합포인트+타매장 잔액 합) — 벤더 POS 화면에 밀어넣을 "가용" 숫자. */
export async function getAvailableForStore(customerId: string, storeId: string) {
  const companyId = await companyIdOfStore(storeId);
  const [storeAccount, hqAccount, otherStoreAccounts] = await Promise.all([
    getOrCreateAccount(customerId, storeId, "STORE", companyId),
    getOrCreateAccount(customerId, null, "HQ", companyId),
    PointAccount.find({ userId: customerId, type: "STORE", companyId, storeId: { $ne: new Types.ObjectId(storeId) } }),
  ]);
  return storeAccount.balance + hqAccount.balance + otherStoreAccounts.reduce((s, a) => s + a.balance, 0);
}

/**
 * 카운터 수동 적립 — 계산원이 POS 앱에서 고객을 매칭한 뒤 **적립할 포인트**를 직접 입력해 적립한다.
 * 적립 비율은 이 프로그램이 정하지 않는다(포스기 프로그램에서 관리) — 정상 흐름에서는 포스기 프로그램이
 * 계산한 적립액이 에이전트로 자동 반영되고(posAgentEarn), 이 수동 적립은 그 보조 수단이다.
 * write_earn 스코프가 동의된 매장에서만 허용.
 */
function actorTypeOf(role?: string): "STORE_ADMIN" | "HQ_ADMIN" {
  return role === "owner" || role === "admin" ? "HQ_ADMIN" : "STORE_ADMIN";
}
function actorLabel(role?: string): string {
  return role === "owner" ? "본사" : role === "admin" ? "고객사 운영자" : "매장 관리자";
}

export async function posEarn(
  storeId: string,
  customerId: string,
  earnAmountInput: number,
  actorStaffId: string,
  clientTxnId?: string,
  actorRole?: string
) {
  if (!Number.isFinite(earnAmountInput) || earnAmountInput <= 0) throw new ApiError(400, "INVALID_AMOUNT");
  const store = await Store.findById(storeId);
  if (!store) throw new ApiError(404, "STORE_NOT_FOUND");
  const companyId = String(store.companyId);
  if (!store.posIntegration.scopes.includes("write_earn")) {
    throw new ApiError(403, "WRITE_EARN_NOT_CONSENTED");
  }

  const earnAmount = Math.floor(earnAmountInput);
  if (earnAmount <= 0) throw new ApiError(400, "INVALID_AMOUNT");

  // 멱등키가 있으면 "이벤트 기록 생성"을 적립보다 먼저 시도한다 — clientTxnId 유니크
  // 인덱스가 걸려있어 이 insert 자체가 원자적인 "선점"이 된다. 두 요청이 진짜 동시에
  // 와도 DB가 하나만 통과시키므로, 잔액 적립(비원자적 두 번째 단계) 전에 중복을
  // 확실히 걸러낼 수 있다 — 반대로 적립부터 하면 그 사이 레이스로 두 번 적립될 수 있음.
  let event;
  try {
    event = await PointEvent.create({
      userId: customerId,
      companyId,
      storeId,
      type: "EARN",
      amount: earnAmount,
      status: "CONFIRMED",
      approvedBy: actorStaffId,
      clientTxnId,
      recordedAt: new Date(),
      reason: `웹 관리모드 수동 적립 (${actorLabel(actorRole)})`,
    });
  } catch (e) {
    if (clientTxnId && (e as { code?: number }).code === 11000) {
      const existing = await PointEvent.findOne({ storeId, clientTxnId }).lean();
      if (existing) return { event: existing, earnAmount: existing.amount };
    }
    throw e;
  }

  const account = await getOrCreateAccount(customerId, storeId, "STORE", companyId);
  if (earnAmount > 0) await atomicCredit(account._id, earnAmount);

  await AuditLog.create({
    storeId,
    actorType: actorTypeOf(actorRole),
    actorId: actorStaffId,
    action: "POS_EARN",
    scope: "write_earn",
    meta: { customerId, earnAmount, eventId: event._id, via: "WEB_MANUAL" },
  });
  publishPointChange({ companyId, storeId, userId: customerId }, "EARN");

  return { event, earnAmount };
}

/**
 * 카운터 결제(POS 체크아웃) — 매장 포인트만으로 부족하면 통합포인트 → 같은 고객사 타매장 포인트
 * 순서로 부족분을 자동 차감한다. 매장 직원이 그 자리에서 처리하는 즉시결제이므로
 * 별도 승인 절차 없이 즉시 확정(CONFIRMED)한다 (설계문서 13-2 결정사항).
 * write_redeem 스코프가 동의된 매장에서만 허용.
 */
export async function posCheckout(
  storeId: string,
  customerId: string,
  amount: number,
  actorStaffId: string,
  clientTxnId?: string,
  actorRole?: string
) {
  if (!Number.isFinite(amount) || amount <= 0) throw new ApiError(400, "INVALID_AMOUNT");
  const store = await Store.findById(storeId);
  if (!store) throw new ApiError(404, "STORE_NOT_FOUND");
  const companyId = String(store.companyId);
  if (!store.posIntegration.scopes.includes("write_redeem")) {
    throw new ApiError(403, "WRITE_REDEEM_NOT_CONSENTED");
  }

  // 흔한 경우(새로고침·이중클릭)는 여기서 미리 걸러 불필요한 차감 자체를 피한다.
  if (clientTxnId) {
    const dup = await PointEvent.findOne({ storeId, clientTxnId }).lean();
    if (dup) return { event: dup, breakdown: (dup as unknown as { meta?: { breakdown: unknown } }).meta?.breakdown ?? [] };
  }

  // 다른 곳(포스기 사용 조회 중 또는 다른 웹 처리)이 이 손님의 포인트를 사용 처리 중이면 이중 사용을 막기 위해 거부한다.
  // 같은 잠금을 쓰므로, 웹에서 사용 처리하는 동안에는 포스기의 사용 조회도 막힌다.
  let lockId: Types.ObjectId | null = null;
  try {
    const lock = await RedeemLock.create({ userId: customerId, storeId });
    lockId = lock._id;
  } catch (e) {
    if ((e as { code?: number }).code === 11000) throw new RedeemBusyError(await redeemLockHolderInfo(customerId));
    throw e;
  }
  try {
  const breakdown = await debitAvailable(customerId, storeId, amount);
  if (!breakdown) throw new ApiError(400, "INSUFFICIENT_BALANCE");

  let event;
  try {
    event = await PointEvent.create({
      userId: customerId,
      companyId,
      storeId,
      type: "REDEEM",
      amount,
      status: "CONFIRMED",
      approvedBy: actorStaffId,
      clientTxnId,
      recordedAt: new Date(),
      reason: `POS_CHECKOUT 웹 관리모드 수동 사용 (${actorLabel(actorRole)})`,
    });
  } catch (e) {
    if (clientTxnId && (e as { code?: number }).code === 11000) {
      // 진짜 동시요청 레이스 — 방금 debitAvailable로 차감한 만큼을 되돌린다(각 계좌별로 breakdown 그대로 환급).
      for (const b of breakdown) {
        if (b.source === "STORE_SELF") {
          const acc = await getOrCreateAccount(customerId, storeId, "STORE", companyId);
          await atomicCredit(acc._id, b.amount);
        } else if (b.source === "HQ") {
          const acc = await getOrCreateAccount(customerId, null, "HQ", companyId);
          await atomicCredit(acc._id, b.amount);
        } else if (b.source.startsWith("STORE:")) {
          const acc = await getOrCreateAccount(customerId, b.source.slice(6), "STORE", companyId);
          await atomicCredit(acc._id, b.amount);
        }
      }
      const existing = await PointEvent.findOne({ storeId, clientTxnId }).lean();
      if (existing) return { event: existing, breakdown };
    }
    throw e;
  }

  await AuditLog.create({
    storeId,
    actorType: actorTypeOf(actorRole),
    actorId: actorStaffId,
    action: "POS_CHECKOUT",
    scope: "write_redeem",
    meta: { customerId, amount, breakdown, eventId: event._id, via: "WEB_MANUAL" },
  });
  publishPointChange({ companyId, storeId, userId: customerId }, "USE");

  return { event, breakdown };
  } finally {
    if (lockId) await RedeemLock.deleteOne({ _id: lockId }).catch(() => {});
  }
}

export type VendorSyncEvent = {
  vendorTxnId: string;
  // 벤더(포스기 프로그램)가 이미 계산해 넘겨준 적립/사용액을 그대로 반영한다. 적립 비율은
  // 이 프로그램이 정하지 않는다.
  type: "EARN" | "USE";
  amount: number;
};

/**
 * 벤더(챔프 등) POS 터미널 에이전트가 주기적으로 호출하는 사후 동기화.
 * 순서가 중요하다: ①이미 반영된 이벤트는 vendorTxnId로 걸러 스킵(멱등) → ②최초 연결
 * 시점이면 벤더 쪽에 남아있던 기존 잔액을 1회 수입(import) → ③이번에 새로 발생한
 * EARN/USE를 순서대로 반영 → ④끝난 뒤의 "가용" 총액을 계산해 돌려준다(에이전트가
 * 그 값을 벤더 POS의 회원 잔액 필드에 그대로 써넣어 화면에 보이게 함).
 * USE가 우리 쪽 잔액보다 큰 경우도 거부하지 않고 그대로 반영한다(음수 허용) —
 * 이미 벤더 POS에서 손님에게 실제로 할인이 나간 확정된 사실이라 우리가 뒤늦게
 * "잔액 부족"이라며 되돌릴 방법이 없기 때문. 다만 감사로그에 결손(shortfall)을
 * 남겨서 고객사 운영자가 사후에 인지할 수 있게 한다.
 */
export async function applyVendorSync(
  storeId: string,
  customerId: string,
  events: VendorSyncEvent[],
  existingVendorBalance: number | null,
  terminalId: string
) {
  const applied: { vendorTxnId: string; type: string; amount: number; note?: string }[] = [];
  const companyId = await companyIdOfStore(storeId);

  // 이 포스기에서 이 고객의 레거시 잔액을 가져온 적이 없는지 확인(포스기 단위 — 매장의
  // 다른 포스기에서 이미 실적립/사용이 있었어도 이 포스기 몫은 별도로 가져와야 함).
  const canImport = existingVendorBalance && existingVendorBalance > 0
    ? await claimVendorImport(storeId, terminalId, customerId, existingVendorBalance, "LAZY")
    : false;
  if (canImport) {
    const account = await getOrCreateAccount(customerId, storeId, "STORE", companyId);
    await atomicCredit(account._id, existingVendorBalance!);
    await PointEvent.create({
      userId: customerId,
      companyId,
      storeId,
      type: "VENDOR_IMPORT",
      amount: existingVendorBalance,
      status: "CONFIRMED",
      reason: `최초 연결 시 벤더 POS 기존 잔액 수입 (terminal ${terminalId})`,
    });
    applied.push({ vendorTxnId: "__IMPORT__", type: "VENDOR_IMPORT", amount: existingVendorBalance! });
    await AuditLog.create({
      storeId,
      actorType: "AGENT",
      actorId: terminalId,
      action: "VENDOR_IMPORT",
      meta: { customerId, amount: existingVendorBalance },
    });
  }

  for (const ev of events) {
    if (ev.amount <= 0) continue;
    const dup = await PointEvent.findOne({ storeId, vendorTxnId: ev.vendorTxnId }).lean();
    if (dup) continue; // 이미 반영됨 — 재전송이어도 안전(멱등)

    if (ev.type === "EARN") {
      const account = await getOrCreateAccount(customerId, storeId, "STORE", companyId);
      await atomicCredit(account._id, ev.amount);
      await PointEvent.create({
        userId: customerId,
      companyId,
        storeId,
        type: "VENDOR_EARN",
        amount: ev.amount,
        status: "CONFIRMED",
        vendorTxnId: ev.vendorTxnId,
        reason: `벤더 POS 적립 동기화 (terminal ${terminalId})`,
      });
      applied.push({ vendorTxnId: ev.vendorTxnId, type: "VENDOR_EARN", amount: ev.amount });
    } else if (ev.type === "USE") {
      const breakdown = await debitAvailable(customerId, storeId, ev.amount);
      let note: string | undefined;
      if (!breakdown) {
        // 잔액 부족 — 벤더 POS에서 이미 확정된 결제라 되돌릴 수 없음. 있는 만큼만 매장계좌에서
        // 강제 차감해 마이너스로 만들고 결손을 감사로그에 남긴다(고객사 운영자 수동정산 대상).
        const storeAccount = await getOrCreateAccount(customerId, storeId, "STORE", companyId);
        await PointAccount.findByIdAndUpdate(storeAccount._id, { $inc: { balance: -ev.amount } });
        note = "SHORTFALL_FORCED_NEGATIVE";
      }
      await PointEvent.create({
        userId: customerId,
      companyId,
        storeId,
        type: "VENDOR_USE",
        amount: ev.amount,
        status: "CONFIRMED",
        vendorTxnId: ev.vendorTxnId,
        reason: `벤더 POS 사용 동기화 (terminal ${terminalId})${note ? " — " + note : ""}`,
      });
      applied.push({ vendorTxnId: ev.vendorTxnId, type: "VENDOR_USE", amount: ev.amount, note });
      if (note) {
        await AuditLog.create({
          storeId,
          actorType: "AGENT",
          actorId: terminalId,
          action: "VENDOR_USE_SHORTFALL",
          meta: { customerId, amount: ev.amount, vendorTxnId: ev.vendorTxnId },
        });
      }
    }
  }

  const availableBalance = await getAvailableForStore(customerId, storeId);
  return { applied, availableBalance };
}

// 회원이면 누구나(본사·고객사 운영자·매장 관리자 포함) 고객으로서 조회될 수 있다 — role 구분 없음.
export async function lookupCustomerByPhone(phone: string) {
  const raw = String(phone ?? "").trim();
  const digits = raw.replace(/[^0-9]/g, "");
  if (!digits) return null;
  return User.findOne({ phone: { $in: [...new Set([raw, digits])] } }).lean();
}

/**
 * 전화번호로 고객을 찾고, 없으면 그 자리에서 새로 만든다(2026-09-27 결정: 카드는 신원
 * 증거로 쓰지 않고 전화번호만이 신원 근거이므로, 적립/사용 흐름 어디서든 전화번호가
 * 확인되면 곧바로 계정이 있어야 한다 — 계산원이 별도 "가입 승인" 단계를 거칠 필요 없음).
 * 새로 만든 계정에는 임의 초기 비밀번호를 부여한다. 손님이 웹에서 처음 로그인할 때 로그인 화면이 그 비밀번호를
 * 알려주고(`/api/v1/auth/initial-password`), 그 비밀번호로 로그인한 뒤 변경하도록 한 번 안내한다. 로그인이 성공하면
 * 원문은 지워져 이후에는 어디에도 안내하지 않는다. 적립·사용은 계산원이 전화번호를 확인해 처리하므로 로그인 없이도 문제가 없다.
 */
export async function getOrCreateUserByPhone(phone: string) {
  const trimmed = String(phone ?? "").replace(/[^0-9]/g, "");
  if (!trimmed || trimmed.length < 9) throw new ApiError(400, "INVALID_PHONE");
  const existing = await User.findOne({ phone: trimmed });
  if (existing) return existing;

  const { issueDigitalCardNo } = await import("./card");
  const { newInitialCredentials } = await import("./initial-password");
  const creds = await newInitialCredentials();
  const digitalCardNo = await issueDigitalCardNo();
  try {
    return await User.create({
      phone: trimmed,
      passwordHash: creds.hash,
      initialPassword: creds.plain,
      firstLogin: true,
      name: "포인트 손님",
      digitalCardNo,
    });
  } catch (e) {
    // 동시에 같은 전화번호로 두 요청이 들어온 경우(같은 손님이 여러 단말에서 거의 동시에 잡힘) — phone unique 인덱스 충돌
    if ((e as { code?: number }).code === 11000) {
      const created = await User.findOne({ phone: trimmed });
      if (created) return created;
    }
    throw e;
  }
}

// ─── POS 에이전트(챔프 등) 전화번호 기반 적립·사용 (2026-09-27 설계) ──────────────
// 카드는 신원 증거로 쓰지 않는다(빌려 쓸 수 있음) — 전화번호가 확인된 결제만 적립하고,
// 사용도 전화번호로 조회한다. 카드번호는 그 거래의 사실로만 PointEvent에 남긴다(소유권 아님).

/** 포스에서 발생한 시각(occurredAt, 선택)과 서버가 받은 시각의 차이로 "인터넷이 끊겼다 뒤늦게 반영된 건"을 가려낸다. */
function agentTimes(occurredAtIso?: string | null) {
  const recordedAt = new Date();
  let occurredAt = recordedAt;
  if (occurredAtIso) {
    const d = new Date(occurredAtIso);
    // 포스 시계가 크게 틀렸거나 미래/너무 오래된 값은 믿지 않는다(최대 30일 이내, 미래는 현재로 보정)
    if (!isNaN(d.getTime()) && d.getTime() > recordedAt.getTime() - 30 * 24 * 3600 * 1000) {
      occurredAt = d.getTime() > recordedAt.getTime() ? recordedAt : d;
    }
  }
  const delaySec = Math.max(0, Math.round((recordedAt.getTime() - occurredAt.getTime()) / 1000));
  return { occurredAt, recordedAt, delaySec, offline: delaySec > 180 };
}

/** 포스기 ↔ 서버 이동 기록 한 줄. 기록 실패가 포인트 처리를 막지 않게 오류는 삼킨다. */
export async function logPosTransfer(input: {
  storeId: string;
  terminalId?: string | null;
  userId?: string | null;
  phone?: string;
  kind: PosTransferKind;
  direction: "POS_TO_SERVER" | "SERVER_TO_POS" | "NONE";
  amount: number;
  localBefore?: number;
  localAfter?: number;
  serverBalanceAfter?: number;
  vendorTxnId?: string;
  occurredAt?: Date;
  recordedAt?: Date;
  delaySec?: number;
  offline?: boolean;
  note?: string;
}) {
  try {
    const store = await Store.findById(input.storeId).select("companyId").lean();
    await PosTransferLog.create({
      ...input,
      companyId: store?.companyId,
      terminalId: input.terminalId || undefined,
      userId: input.userId || undefined,
      occurredAt: input.occurredAt ?? new Date(),
      recordedAt: input.recordedAt ?? new Date(),
    });
  } catch (e) {
    console.error("[pos-transfer-log] 기록 실패", e);
  }
}

export type AgentEarnInput = {
  storeId: string;
  terminalId: string;
  phone: string;
  // 챔프 자체 포인트 기능(자동 적립이든 계산원 수기 입력이든)이 MEMBER_POINT에 이미 기록한
  // 적립액(MEMP_ADD_AMT) 그대로를 반영한다 — 서버가 별도 요율로 재계산하지 않는다(2026-09-28
  // 결정: 챔프 자체 규칙(메뉴별 배율, 수기 보너스 등)을 서버가 재현할 수 없으므로 챔프가
  // 이미 계산한 숫자를 신뢰하는 쪽이 맞음).
  addAmount: number;
  saleAmount?: number; // 참고용(감사로그 사유 문구에만 사용, 계산에는 안 씀)
  cardNo?: string;
  vendorTxnId: string; // 이 결제 1건의 멱등키(챔프 거래키 조합) — 재전송돼도 중복 적립 안 됨
  existingVendorBalance?: number | null; // 이 매장에서 이 고객이 처음 동기화되는 순간이면, 벤더 POS에 남아있던 잔액(1회 수입)
  occurredAt?: string | null; // 포스에서 실제 결제된 시각(오프라인 후 뒤늦게 반영될 때 원래 시각을 보존)
};

/** 에이전트가 결제완료 트리거로 호출 — 전화번호가 확인된(회원 레코드에 등록된) 거래만 적립한다. */
export async function posAgentEarn(input: AgentEarnInput) {
  const { storeId, terminalId, phone, addAmount, saleAmount, cardNo, vendorTxnId, existingVendorBalance } = input;
  if (addAmount <= 0) throw new ApiError(400, "INVALID_AMOUNT");
  const when = agentTimes(input.occurredAt);
  const store = await Store.findById(storeId);
  if (!store) throw new ApiError(404, "STORE_NOT_FOUND");
  const companyId = String(store.companyId);

  const user = await getOrCreateUserByPhone(phone);
  const customerId = String(user._id);

  // 이 포스기에서 이 고객의 레거시 잔액을 가져온 적이 없으면(포스기 단위 — 매장의 다른
  // 포스기가 이미 실적립 중이어도 이 포스기 몫은 별도로), 넘어온 잔액을 1회 수입한다.
  const canImport = existingVendorBalance && existingVendorBalance > 0
    ? await claimVendorImport(storeId, terminalId, customerId, existingVendorBalance, "LAZY")
    : false;
  if (canImport) {
    const importAccount = await getOrCreateAccount(customerId, storeId, "STORE", companyId);
    await atomicCredit(importAccount._id, existingVendorBalance!);
    await PointEvent.create({
      userId: customerId,
      companyId,
      storeId,
      terminalId,
      cardNo,
      type: "VENDOR_IMPORT",
      amount: existingVendorBalance,
      status: "CONFIRMED",
      reason: `최초 연결 시 벤더 POS 기존 잔액 수입 (전화번호 확인, terminal ${terminalId})`,
    });
    await AuditLog.create({
      storeId,
      actorType: "AGENT",
      actorId: terminalId,
      action: "VENDOR_IMPORT",
      meta: { customerId, amount: existingVendorBalance, cardNo },
    });
  }

  const earnAmount = Math.floor(addAmount);

  let event;
  try {
    event = await PointEvent.create({
      userId: customerId,
      companyId,
      storeId,
      terminalId,
      cardNo,
      type: "VENDOR_EARN",
      amount: earnAmount,
      status: "CONFIRMED",
      vendorTxnId,
      occurredAt: when.occurredAt,
      recordedAt: when.recordedAt,
      offline: when.offline,
      reason: `포스 자체 적립 반영 (챔프 기록 ${addAmount}원${saleAmount ? `, 결제액 ${saleAmount}` : ""}, terminal ${terminalId})`,
    });
  } catch (e) {
    if ((e as { code?: number }).code === 11000) {
      const existingEvt = await PointEvent.findOne({ storeId, vendorTxnId }).lean();
      if (existingEvt) {
        return { event: existingEvt, earnAmount: existingEvt.amount, duplicate: true, availableBalance: await getAvailableForStore(customerId, storeId) };
      }
    }
    throw e;
  }

  if (earnAmount > 0) {
    const account = await getOrCreateAccount(customerId, storeId, "STORE", companyId);
    await atomicCredit(account._id, earnAmount);
  }

  const availableBalance = await getAvailableForStore(customerId, storeId);
  await logPosTransfer({
    storeId, terminalId, userId: customerId, phone, kind: "EARN_TO_SERVER", direction: "POS_TO_SERVER", amount: earnAmount,
    serverBalanceAfter: availableBalance, vendorTxnId, occurredAt: when.occurredAt, recordedAt: when.recordedAt, delaySec: when.delaySec, offline: when.offline,
    note: when.offline ? "인터넷 끊김 후 뒤늦게 서버에 반영" : undefined,
  });
  publishPointChange({ companyId, storeId, userId: customerId }, "EARN");
  return { event, earnAmount, availableBalance, customerId };
}

/** 결제 취소로 챔프가 적립을 되돌린 건(MEMP_ADD_AMT < 0) — 서버 이 매장 계좌에서 그만큼 차감한다(이미 써서 모자라면 마이너스로 강제 차감 + 감사로그). */
export async function posAgentEarnCancel(input: { storeId: string; terminalId: string; phone: string; cancelAmount: number; cardNo?: string; vendorTxnId: string; occurredAt?: string | null }) {
  const { storeId, terminalId, phone, cardNo, vendorTxnId } = input;
  const cancelAmount = Math.floor(input.cancelAmount);
  if (!(cancelAmount > 0)) throw new ApiError(400, "INVALID_AMOUNT");
  const companyId = await companyIdOfStore(storeId);
  const user = await getOrCreateUserByPhone(phone);
  const customerId = String(user._id);
  const when = agentTimes(input.occurredAt);

  const dup = await PointEvent.findOne({ storeId, vendorTxnId }).lean();
  if (dup) return { event: dup, duplicate: true, availableBalance: await getAvailableForStore(customerId, storeId) };

  const account = await getOrCreateAccount(customerId, storeId, "STORE", companyId);
  const before = account.balance;
  await PointAccount.findByIdAndUpdate(account._id, { $inc: { balance: -cancelAmount } });
  let event;
  try {
    event = await PointEvent.create({
      userId: customerId, companyId, storeId, terminalId, cardNo, type: "EARN_CANCEL", amount: cancelAmount, status: "CONFIRMED", vendorTxnId,
      occurredAt: when.occurredAt, recordedAt: when.recordedAt, offline: when.offline,
      reason: `결제 취소로 적립 취소 (terminal ${terminalId})`,
    });
  } catch (e) {
    // 같은 취소가 동시에 두 번 들어온 경우 — 방금 차감한 것을 되돌린다
    if ((e as { code?: number }).code === 11000) {
      await PointAccount.findByIdAndUpdate(account._id, { $inc: { balance: cancelAmount } });
      const existing = await PointEvent.findOne({ storeId, vendorTxnId }).lean();
      return { event: existing, duplicate: true, availableBalance: await getAvailableForStore(customerId, storeId) };
    }
    throw e;
  }
  if (before < cancelAmount) {
    await AuditLog.create({ storeId, actorType: "AGENT", actorId: terminalId, action: "EARN_CANCEL_SHORTFALL", meta: { customerId, amount: cancelAmount, vendorTxnId, balanceBefore: before } });
  }
  const availableBalance = await getAvailableForStore(customerId, storeId);
  await logPosTransfer({ storeId, terminalId, userId: customerId, phone, kind: "EARN_CANCEL", direction: "POS_TO_SERVER", amount: -cancelAmount, serverBalanceAfter: availableBalance, vendorTxnId, occurredAt: when.occurredAt, recordedAt: when.recordedAt, delaySec: when.delaySec, offline: when.offline });
  publishPointChange({ companyId, storeId, userId: customerId }, "EARN_CANCEL");
  return { event, availableBalance, customerId };
}

/** 결제 취소로 챔프가 사용을 되돌린 건(MEMP_USED_AMT < 0) — 이 매장 계좌로 환원한다. */
export async function posAgentRedeemCancel(input: { storeId: string; terminalId: string; phone: string; refundAmount: number; cardNo?: string; vendorTxnId: string; occurredAt?: string | null }) {
  const { storeId, terminalId, phone, cardNo, vendorTxnId } = input;
  const refundAmount = Math.floor(input.refundAmount);
  if (!(refundAmount > 0)) throw new ApiError(400, "INVALID_AMOUNT");
  const companyId = await companyIdOfStore(storeId);
  const user = await getOrCreateUserByPhone(phone);
  const customerId = String(user._id);
  const when = agentTimes(input.occurredAt);

  const dup = await PointEvent.findOne({ storeId, vendorTxnId }).lean();
  if (dup) return { event: dup, duplicate: true, availableBalance: await getAvailableForStore(customerId, storeId) };

  let event;
  try {
    event = await PointEvent.create({
      userId: customerId, companyId, storeId, terminalId, cardNo, type: "USE_CANCEL", amount: refundAmount, status: "CONFIRMED", vendorTxnId,
      occurredAt: when.occurredAt, recordedAt: when.recordedAt, offline: when.offline,
      reason: `결제 취소로 사용 취소(환원) (terminal ${terminalId})`,
    });
  } catch (e) {
    if ((e as { code?: number }).code === 11000) {
      const existing = await PointEvent.findOne({ storeId, vendorTxnId }).lean();
      return { event: existing, duplicate: true, availableBalance: await getAvailableForStore(customerId, storeId) };
    }
    throw e;
  }
  const account = await getOrCreateAccount(customerId, storeId, "STORE", companyId);
  await atomicCredit(account._id, refundAmount);
  const availableBalance = await getAvailableForStore(customerId, storeId);
  await logPosTransfer({ storeId, terminalId, userId: customerId, phone, kind: "USE_CANCEL", direction: "POS_TO_SERVER", amount: -refundAmount, serverBalanceAfter: availableBalance, vendorTxnId, occurredAt: when.occurredAt, recordedAt: when.recordedAt, delaySec: when.delaySec, offline: when.offline });
  publishPointChange({ companyId, storeId, userId: customerId }, "USE_CANCEL");
  return { event, availableBalance, customerId };
}

// ─── 매장 전체 일괄 초기 이전 (2026-09-27 추가) ────────────────────────────────
// posAgentEarn의 1회성 수입(카드별·손님 방문 시점)은 손님이 다시 올 때까지 기다려야 하는
// "느긋한" 방식이라, 프랜차이즈 전체가 한꺼번에 계약해 시작할 때는 안 맞는다. 매장이
// 포스 프로그램을 처음 설치할 때, 전화번호가 있는 기존 회원 전원의 잔액을 한 번에
// 걷어오는 용도. 같은 전화번호가 여러 회원번호로 중복 등록돼 있으면(포스기 쪽 데이터
// 정리 미흡 등) 합산해서 한 계정으로 들여온다 — 어차피 같은 사람의 포인트이므로.

export type BulkImportEntry = { phone: string; cardNo?: string; balance: number };
export type BulkImportResult = {
  imported: number; // 새로 이전된 손님 수
  alreadyLinked: number; // 이 매장에 이미 계좌가 있어 건너뛴 손님 수(중복 실행 방지)
  skippedInvalidPhone: number;
  totalAmount: number;
  // 이 포스기에서 이 고객의 포인트를 이미 이전한 기록이 있어 이번에는 반영하지 않은 항목(포스 잔액이 영점화되지 않은 것으로 보임).
  // alreadyApplied: 포스 잔액이 이전 기록 이하 — 이미 서버에 있는 포인트라 포스 쪽을 0으로 정리하면 된다.
  // held: 포스 잔액이 이전 기록보다 많음 — 어디서 늘었는지 알 수 없어 자동 처리하지 않고 사람이 확인해야 한다(포스 잔액은 그대로 둔다).
  alreadyApplied?: { phone: string; balance: number }[];
  held?: { phone: string; balance: number; previous: number; kind?: "MORE_THAN_IMPORTED" | "STORE_REPLICA_SUSPECT" }[];
};

/** 이 포스기에서 이 고객에 대해 이미 서버로 이전한 포인트 합계(이전 내역·옛 이전 기록·본사가 기각한 보류 건 중 큰 값). */
async function previousImportedFromTerminal(terminalId: string, userId: string): Promise<number> {
  const [events, records, dismissed] = await Promise.all([
    PointEvent.find({ terminalId, userId, type: "VENDOR_IMPORT" }).select("amount").lean(),
    VendorImportRecord.find({ terminalId, userId }).select("amount").lean(),
    // 본사가 "더하지 않음"으로 기각한 보류 건 — 그 포스 잔액은 이미 처리된 것으로 본다(포스 프로그램이 포스 잔액만 0으로 정리).
    ImportHold.find({ terminalId, userId, status: "DISMISSED" }).select("balance").lean(),
  ]);
  const fromEvents = events.reduce((s, e) => s + (e.amount || 0), 0);
  const fromRecords = records.reduce((s, r) => s + (r.amount || 0), 0);
  const fromDismissed = dismissed.reduce((m, h) => Math.max(m, h.balance || 0), 0);
  return Math.max(fromEvents, fromRecords, fromDismissed);
}

/** 같은 매장의 다른 포스기들이 이 고객에 대해 이미 서버로 이전한 포인트 중 가장 큰 합계(포스기별 합계의 최댓값). */
async function otherTerminalsImportedMax(storeId: string, terminalId: string, userId: string): Promise<number> {
  const [events, records] = await Promise.all([
    PointEvent.find({ storeId, userId, type: "VENDOR_IMPORT", terminalId: { $ne: terminalId } }).select("terminalId amount").lean(),
    VendorImportRecord.find({ storeId, userId, terminalId: { $ne: terminalId } }).select("terminalId amount").lean(),
  ]);
  const perTerminal = new Map<string, { ev: number; rec: number }>();
  for (const e of events) {
    const k = String(e.terminalId);
    const cur = perTerminal.get(k) ?? { ev: 0, rec: 0 };
    cur.ev += e.amount || 0;
    perTerminal.set(k, cur);
  }
  for (const r of records) {
    const k = String(r.terminalId);
    const cur = perTerminal.get(k) ?? { ev: 0, rec: 0 };
    cur.rec += r.amount || 0;
    perTerminal.set(k, cur);
  }
  let max = 0;
  for (const v of perTerminal.values()) max = Math.max(max, v.ev, v.rec);
  return max;
}

/** 보류 건을 남긴다 — 같은 포스기·고객·잔액의 열린 건이 이미 있으면 새로 만들지 않고 확인 시각만 갱신한다. */
async function recordImportHold(input: {
  storeId: string; companyId: string; terminalId: string; userId: string; phone: string; kind: "MORE_THAN_IMPORTED" | "STORE_REPLICA_SUSPECT";
  balance: number; amount: number; previous: number; batchId?: string;
}) {
  try {
    await ImportHold.findOneAndUpdate(
      { terminalId: input.terminalId, userId: input.userId, status: "OPEN", balance: input.balance },
      { $set: { lastSeenAt: new Date() }, $setOnInsert: { ...input, status: "OPEN", createdAt: new Date() } },
      { upsert: true }
    );
  } catch (e) {
    console.error("[import-hold] 보류 건 기록 실패", e); // 기록 실패가 이전 처리를 막지 않는다(감사로그에는 남음)
  }
}

export async function bulkImportLegacyBalances(
  storeId: string,
  terminalId: string,
  entries: BulkImportEntry[],
  batchId?: string
): Promise<BulkImportResult> {
  const store = await Store.findById(storeId);
  if (!store) throw new ApiError(404, "STORE_NOT_FOUND");
  const companyId = String(store.companyId);

  // 같은 전화번호가 여러 줄로 들어오면(포스기 쪽 중복 회원) 합산 — 카드번호는 감사기록용으로 첫 값만 남긴다.
  const byPhone = new Map<string, { balance: number; cardNo?: string }>();
  let skippedInvalidPhone = 0;
  for (const e of entries) {
    const trimmed = (e.phone || "").replace(/[^0-9]/g, "");
    if (!trimmed || trimmed.length < 9 || !(e.balance > 0)) {
      skippedInvalidPhone++;
      continue;
    }
    const cur = byPhone.get(trimmed);
    if (cur) cur.balance += e.balance;
    else byPhone.set(trimmed, { balance: e.balance, cardNo: e.cardNo });
  }

  let imported = 0;
  let alreadyLinked = 0;
  let totalAmount = 0;
  const alreadyApplied: { phone: string; balance: number }[] = [];
  const held: { phone: string; balance: number; previous: number; kind?: "MORE_THAN_IMPORTED" | "STORE_REPLICA_SUSPECT" }[] = [];

  for (const [phone, { balance, cardNo }] of byPhone) {
    const user = await getOrCreateUserByPhone(phone);
    const customerId = String(user._id);
    // 같은 포스기에서 이 고객의 포인트를 이미 이전했다면(영점화가 안 된 채 남은 포스 잔액을 다시 보내는 경우 — 프로그램 업데이트 중 이전만 되고
    // 영점화가 안 된 경우 등) 이중 반영하지 않는다. 이후 정상 흐름에서 포스 잔액은 이전할 때마다 0이 되므로, 이전 기록이 있는 고객의
    // 포스 잔액이 다시 남아 있다면 이미 서버에 반영된 포인트로 본다. 이전 기록보다 잔액이 많으면 자동 처리하지 않고 사람이 확인하게 한다.
    // (같은 묶음의 재시도는 아래 importTxnId 검사가 따로 처리한다.)
    const prevImported = await previousImportedFromTerminal(terminalId, customerId);
    if (prevImported > 0) {
      const sameBatch = batchId ? await PointEvent.exists({ storeId, vendorTxnId: `IMPORT-${terminalId}-${batchId}-${phone}-${balance}` }) : null;
      if (!sameBatch) {
        if (balance <= prevImported + 0.5) alreadyApplied.push({ phone, balance });
        else {
          held.push({ phone, balance, previous: prevImported, kind: "MORE_THAN_IMPORTED" });
          await recordImportHold({ storeId, companyId, terminalId, userId: customerId, phone, kind: "MORE_THAN_IMPORTED", balance, amount: Math.round((balance - prevImported) * 100) / 100, previous: prevImported, batchId });
        }
        alreadyLinked++;
        await AuditLog.create({
          storeId,
          actorType: "AGENT",
          actorId: terminalId,
          action: balance <= prevImported + 0.5 ? "IMPORT_SKIPPED_ALREADY_IMPORTED" : "IMPORT_HELD_REVIEW",
          meta: { customerId, phone, balance, previousImported: prevImported, batchId },
        });
        continue;
      }
    }
    // 같은 매장의 다른 포스기가 이미 이 고객의 포인트를 이전했고 이번 포스기의 잔액이 거의 같다면, 포스기들의 DB 가 서로 복제돼 같은 포인트를
    // 각 포스기가 따로 보내는 것일 수 있다 — 그대로 더하면 포스기 수만큼 부풀어 오르므로 자동으로 더하지 않고 본사가 확인하게 한다.
    // (포스기마다 로컬 DB 가 따로라 잔액이 서로 다른 경우는 이 조건에 걸리지 않고 정상으로 합산된다.)
    if (prevImported === 0) {
      const otherMax = await otherTerminalsImportedMax(storeId, terminalId, customerId);
      if (otherMax > 0 && Math.abs(balance - otherMax) <= Math.max(1, otherMax * 0.02)) {
        held.push({ phone, balance, previous: otherMax, kind: "STORE_REPLICA_SUSPECT" });
        alreadyLinked++;
        await recordImportHold({ storeId, companyId, terminalId, userId: customerId, phone, kind: "STORE_REPLICA_SUSPECT", balance, amount: balance, previous: otherMax, batchId });
        await AuditLog.create({
          storeId,
          actorType: "AGENT",
          actorId: terminalId,
          action: "IMPORT_HELD_REVIEW",
          meta: { customerId, phone, balance, otherTerminalImported: otherMax, batchId, kind: "STORE_REPLICA_SUSPECT" },
        });
        continue;
      }
    }
    // 이 포스기에서 이 고객 몫을 이미 가져왔으면 스킵(포스기 단위 — 같은 매장의 다른
    // 포스기에서 이미 실적립·다른 초기화가 있었어도 이 포스기 몫은 별도로 더해야 함).
    // batchId가 있으면(새 프로그램) 몇 번을 다시 실행해도 안전한 방식: (포스기, 이전 묶음, 전화번호, 금액)이 같은 요청은 한 번만 반영된다 —
    // 응답이 끊겨 같은 요청을 다시 보내도 중복 적립되지 않고, 이후에 새로 쌓인 잔액은 다른 묶음으로 정상 반영된다.
    // batchId가 없으면(옛 프로그램) 예전처럼 포스기·고객당 1회만 가져온다.
    const importTxnId = batchId ? `IMPORT-${terminalId}-${batchId}-${phone}-${balance}` : undefined;
    if (!importTxnId) {
      const canImport = await claimVendorImport(storeId, terminalId, customerId, balance, "BULK");
      if (!canImport) {
        alreadyLinked++;
        continue;
      }
    } else if (await PointEvent.exists({ storeId, vendorTxnId: importTxnId })) {
      alreadyLinked++;
      continue;
    }
    try {
      await PointEvent.create({
        userId: customerId,
        companyId,
        storeId,
        terminalId,
        cardNo,
        type: "VENDOR_IMPORT",
        amount: balance,
        status: "CONFIRMED",
        vendorTxnId: importTxnId,
        recordedAt: new Date(),
        reason: `포스 포인트 서버 이전 (terminal ${terminalId}${batchId ? `, 묶음 ${batchId}` : ""})`,
      });
    } catch (e) {
      if ((e as { code?: number }).code === 11000) {
        alreadyLinked++; // 동시에 같은 요청이 들어온 경우
        continue;
      }
      throw e;
    }
    const account = await getOrCreateAccount(customerId, storeId, "STORE", companyId);
    await atomicCredit(account._id, balance);
    await logPosTransfer({ storeId, terminalId, userId: customerId, phone, kind: "BULK_IMPORT", direction: "POS_TO_SERVER", amount: balance, note: "포스 포인트 서버 이전" });
    publishPointChange({ companyId, storeId, userId: customerId }, "BULK_IMPORT");
    await AuditLog.create({
      storeId,
      actorType: "AGENT",
      actorId: terminalId,
      action: "BULK_VENDOR_IMPORT",
      meta: { customerId, phone, amount: balance, cardNo },
    });
    imported++;
    totalAmount += balance;
  }

  return { imported, alreadyLinked, skippedInvalidPhone, totalAmount, alreadyApplied, held };
}

/**
 * 사용 팝업이 전화번호를 받았을 때 — 신규 손님이면 그 자리에서 계정을 만들고 가용 잔액(0원)을
 * 돌려준다. 같은 고객을 다른 포스기(다른 매장이든 같은 매장이든)에서 거의 동시에 조회해 각자
 * 화면에 띄운 뒤 각각 사용해버리면 서버 잔액은 하나인데 이중사용이 생길 수 있어(2026-09-28),
 * 조회 시점에 고객 단위로 잠근다 — 이미 다른 포스기가 조회 중이면 거부한다.
 */
/** 이 고객을 지금 사용 처리 중인 곳(고객사·매장·포스기 또는 웹 관리모드) — 안내문에 쓴다. */
async function redeemLockHolderInfo(customerId: string): Promise<{ companyName?: string; storeName?: string; terminalName?: string }> {
  const holder = await RedeemLock.findOne({ userId: customerId }).lean();
  if (!holder) return {};
  const [hs, ht] = await Promise.all([
    Store.findById(holder.storeId).select("name companyId").lean(),
    holder.terminalId ? PosTerminal.findById(holder.terminalId).select("name").lean() : Promise.resolve(null),
  ]);
  const hc = hs ? await Company.findById(hs.companyId).select("name").lean() : null;
  return { companyName: hc?.name, storeName: hs?.name, terminalName: ht?.name ?? "웹 관리모드" };
}

export class RedeemBusyError extends ApiError {
  holder: { companyName?: string; storeName?: string; terminalName?: string };
  constructor(holder: { companyName?: string; storeName?: string; terminalName?: string }) {
    super(409, "REDEEM_IN_PROGRESS_ELSEWHERE");
    this.holder = holder;
  }
}

// 사용 조회 잠금 유지 시간 — TTL 인덱스(expires: 200초)는 이미 만들어진 운영 DB 에서 바꾸기 어려워서, lockedAt 을 미래 시각으로 두어
// 실제 유지 시간을 200 + 400 = 600초로 늘린다(에이전트의 반영 유효시간 600초보다 넉넉하게). 결제 처리(apply)·release 때 바로 풀린다.
const REDEEM_LOCK_EXTRA_MS = 400_000;
const redeemLockTime = () => new Date(Date.now() + REDEEM_LOCK_EXTRA_MS);

export async function posAgentRedeemLookup(storeId: string, terminalId: string, phone: string) {
  const user = await getOrCreateUserByPhone(phone);
  const customerId = String(user._id);

  try {
    await RedeemLock.create({ userId: customerId, storeId, terminalId, lockedAt: redeemLockTime() });
  } catch (e) {
    if ((e as { code?: number }).code === 11000) {
      // 같은 포스기가 같은 손님을 다시 조회하는 것(전화번호를 잘못 눌렀다 다시 조회, 팝업을 닫았다 다시 열기 등)은 막지 않고
      // 잠금 시간만 갱신한다. 다른 포스기가 잡고 있을 때만 이중사용 방지를 위해 거부한다.
      const held = await RedeemLock.findOneAndUpdate({ userId: customerId, terminalId }, { $set: { lockedAt: redeemLockTime() } });
      if (!held) {
        // 다른 포스기(또는 웹 관리모드)가 이 손님을 사용 조회 중 — 어느 고객사·매장·포스기인지 알려 포스 화면 팝업에 표시한다(적립은 계속 가능).
        throw new RedeemBusyError(await redeemLockHolderInfo(customerId));
      }
    } else {
      throw e;
    }
  }

  const availableBalance = await getAvailableForStore(customerId, storeId);
  return { customerId, availableBalance, name: user.name };
}

/**
 * 이 포스기가 건 사용 조회 잠금을 푼다 — 적립만 하고 계산이 끝났거나(사용 반영이 없어 apply 가 잠금을 풀지 못함) 조회만 하고 결제하지 않은 경우,
 * 다음 손님·다른 포스기가 이 손님 때문에 막히지 않게 한다. 다른 포스기가 건 잠금은 건드리지 않는다. 없는 손님이면 아무것도 하지 않는다(계정을 만들지 않는다).
 */
export async function posAgentRedeemRelease(terminalId: string, phone: string) {
  const user = await lookupCustomerByPhone(phone);
  if (!user) return { released: false };
  const r = await RedeemLock.deleteOne({ userId: String(user._id), terminalId });
  return { released: r.deletedCount > 0 };
}

export type AgentRedeemInput = {
  storeId: string;
  terminalId: string;
  phone: string;
  usedAmount: number;
  cardNo?: string;
  vendorTxnId: string;
  occurredAt?: string | null;
};

/**
 * 결제완료 트리거가 "챔프 자체 포인트결제 기능으로 실제 사용된 금액"(MEMBER_POINT.MEMP_USED_AMT)을
 * 읽어 사후 차감한다. 이미 챔프에서 확정된 사실이라 잔액 부족이어도 거부하지 않고 마이너스로
 * 강제 차감 + 감사로그(SHORTFALL) — applyVendorSync의 USE 분기와 같은 정책.
 */
export async function posAgentRedeemApply(input: AgentRedeemInput) {
  const { storeId, terminalId, phone, usedAmount, cardNo, vendorTxnId } = input;
  if (usedAmount <= 0) throw new ApiError(400, "INVALID_AMOUNT");
  const companyId = await companyIdOfStore(storeId);
  const user = await getOrCreateUserByPhone(phone);
  const customerId = String(user._id);
  const when = agentTimes(input.occurredAt);

  try {
    const dup = await PointEvent.findOne({ storeId, vendorTxnId }).lean();
    if (dup) return { event: dup, duplicate: true, availableBalance: await getAvailableForStore(customerId, storeId) };

    const breakdown = await debitAvailable(customerId, storeId, usedAmount);
    let note: string | undefined;
    if (!breakdown) {
      const storeAccount = await getOrCreateAccount(customerId, storeId, "STORE", companyId);
      await PointAccount.findByIdAndUpdate(storeAccount._id, { $inc: { balance: -usedAmount } });
      note = "SHORTFALL_FORCED_NEGATIVE";
    }
    const event = await PointEvent.create({
      userId: customerId,
      companyId,
      storeId,
      terminalId,
      cardNo,
      type: "VENDOR_USE",
      amount: usedAmount,
      status: "CONFIRMED",
      vendorTxnId,
      occurredAt: when.occurredAt,
      recordedAt: when.recordedAt,
      offline: when.offline,
      reason: `포스 결제 시 포인트 사용 (terminal ${terminalId})${note ? " — " + note : ""}`,
    });
    if (note) {
      await AuditLog.create({
        storeId,
        actorType: "AGENT",
        actorId: terminalId,
        action: "VENDOR_USE_SHORTFALL",
        meta: { customerId, amount: usedAmount, vendorTxnId },
      });
    }
    const availableBalance = await getAvailableForStore(customerId, storeId);
    await logPosTransfer({
      storeId, terminalId, userId: customerId, phone, kind: "USE_TO_SERVER", direction: "POS_TO_SERVER", amount: usedAmount,
      serverBalanceAfter: availableBalance, vendorTxnId, occurredAt: when.occurredAt, recordedAt: when.recordedAt, delaySec: when.delaySec, offline: when.offline,
      note: note ?? (when.offline ? "인터넷 끊김 후 뒤늦게 서버에 반영" : undefined),
    });
    publishPointChange({ companyId, storeId, userId: customerId }, "USE");
    // shortfall: 잔액이 모자라 마이너스로 강제 차감했다 — 포스에서 직원에게 알리고 본사 확인(수동 정산)을 요청한다.
    return { event, breakdown, availableBalance, shortfall: !!note };
  } finally {
    // 성공/중복/에러 어떤 경우든 조회 시점에 걸어둔 잠금은 반드시 풀어준다(다음 손님이 막히지 않게).
    await RedeemLock.deleteOne({ userId: customerId }).catch(() => {});
  }
}

/**
 * 계산원이 결제 시 전화번호로 고객을 확인한 뒤, POS(카운터 단말) 회원카드 식별번호를
 * 그 고객 계정에 연결해둔다. 이후 카드번호만으로도(전화번호 재입력 없이) 같은 고객을
 * 인식할 수 있게 하기 위한 매장별 토큰 역할. 이미 같은 카드번호가 다른 고객에게
 * 연결돼 있으면(카드 재발급 등) 기존 연결을 지우고 새로 연결 + 감사로그를 남긴다.
 */
export async function linkPosCard(storeId: string, customerId: string, cardNo: string, actorId: string) {
  const trimmed = cardNo.trim();
  if (!trimmed) throw new ApiError(400, "CARD_NO_REQUIRED");

  const prevOwner = await User.findOne({
    _id: { $ne: customerId },
    posLinks: { $elemMatch: { storeId, cardNo: trimmed } },
  });
  if (prevOwner) {
    await User.updateOne({ _id: prevOwner._id }, { $pull: { posLinks: { storeId, cardNo: trimmed } } });
    await AuditLog.create({
      storeId,
      actorType: "STORE_ADMIN",
      actorId,
      action: "POS_CARD_RELINKED",
      meta: { cardNo: trimmed, from: String(prevOwner._id), to: customerId },
    });
  }

  await User.updateOne(
    { _id: customerId },
    { $pull: { posLinks: { storeId, cardNo: trimmed } } }
  );
  await User.updateOne(
    { _id: customerId },
    { $push: { posLinks: { storeId, cardNo: trimmed, linkedAt: new Date() } } }
  );

  await AuditLog.create({
    storeId,
    actorType: "STORE_ADMIN",
    actorId,
    action: "POS_CARD_LINKED",
    meta: { customerId, cardNo: trimmed },
  });

  return { customerId, cardNo: trimmed };
}

export async function lookupCustomerByPosCard(storeId: string, cardNo: string) {
  return User.findOne({ posLinks: { $elemMatch: { storeId, cardNo: cardNo.trim() } } }).lean();
}
