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
  const account = await PointAccount.findOneAndUpdate(
    filter,
    { $setOnInsert: { userId, storeId, type, companyId, balance: 0 } },
    { upsert: true, new: true }
  );
  return account;
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
  hq: number; // 통합포인트(고객사 본사 지급분)
  stores: { storeId: string; storeName: string; balance: number }[];
  total: number; // 이 고객사 안에서 쓸 수 있는 통합 잔액
};

/** 고객의 포인트를 **고객사별로** 묶어서 돌려준다 — 고객사가 다르면 잔액을 합치지 않는다. */
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

/** 한 고객사 안에서의 잔액(통합포인트 + 그 고객사 매장들) — 매장·운영자 화면용. 계좌가 없으면 0. */
export async function getCompanyPointSummary(userId: string, companyId: string): Promise<CompanyPointSummary> {
  const all = await getMyPointSummary(userId);
  const found = all.companies.find((c) => c.companyId === String(companyId));
  if (found) return found;
  const company = await Company.findById(companyId).select("name").lean();
  return { companyId: String(companyId), companyName: company?.name ?? "", hq: 0, stores: [], total: 0 };
}

/** 이 고객이 이 고객사에서 이용한 적이 있는가(계좌 또는 내역) — 운영자 고객 조회 범위 판단용. */
export async function hasCompanyRelation(userId: string, companyId: string): Promise<boolean> {
  if (await PointAccount.exists({ userId, companyId })) return true;
  return !!(await PointEvent.exists({ userId, companyId }));
}

export async function getMyPointHistory(userId: string, companyId?: string) {
  const filter: Record<string, unknown> = { userId };
  if (companyId) filter.companyId = companyId;
  return PointEvent.find(filter)
    .sort({ occurredAt: -1 })
    .limit(200)
    .populate("storeId", "name")
    .populate("companyId", "name")
    .lean();
}

/**
 * 고객: 결제 예정 매장으로 포인트 이체. 매장이 POS 연동 동의에서
 * "본사/타매장 포인트 사용 허용"(accept_transfer) 스코프를 켜둔 경우에만
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
 * 매장 포인트만으로 부족하면 본사포인트 → 타매장포인트 순서로 자동 차감한다.
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
export async function posEarn(
  storeId: string,
  customerId: string,
  earnAmountInput: number,
  actorStaffId: string,
  clientTxnId?: string
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
      reason: "POS 수동 적립 (계산원 입력)",
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
    actorType: "AGENT",
    actorId: actorStaffId,
    action: "POS_EARN",
    scope: "write_earn",
    meta: { customerId, earnAmount, eventId: event._id },
  });

  return { event, earnAmount };
}

/**
 * 카운터 결제(POS 체크아웃) — 매장 포인트만으로 부족하면 본사포인트 → 타매장포인트
 * 순서로 부족분을 자동 차감한다. 매장 직원이 그 자리에서 처리하는 즉시결제이므로
 * 별도 승인 절차 없이 즉시 확정(CONFIRMED)한다 (설계문서 13-2 결정사항).
 * write_redeem 스코프가 동의된 매장에서만 허용.
 */
export async function posCheckout(
  storeId: string,
  customerId: string,
  amount: number,
  actorStaffId: string,
  clientTxnId?: string
) {
  if (amount <= 0) throw new ApiError(400, "INVALID_AMOUNT");
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
      reason: "POS_CHECKOUT",
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
    actorType: "AGENT",
    actorId: actorStaffId,
    action: "POS_CHECKOUT",
    scope: "write_redeem",
    meta: { customerId, amount, breakdown, eventId: event._id },
  });

  return { event, breakdown };
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
 * 남겨서 운영자가 사후에 인지할 수 있게 한다.
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
        // 강제 차감해 마이너스로 만들고 결손을 감사로그에 남긴다(운영자 수동정산 대상).
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

// 회원이면 누구나(본사/매장 관리자 포함) 고객으로서 조회될 수 있다 — role 구분 없음.
export async function lookupCustomerByPhone(phone: string) {
  return User.findOne({ phone }).lean();
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
  const trimmed = phone.replace(/[^0-9]/g, "");
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
};

/** 에이전트가 결제완료 트리거로 호출 — 전화번호가 확인된(회원 레코드에 등록된) 거래만 적립한다. */
export async function posAgentEarn(input: AgentEarnInput) {
  const { storeId, terminalId, phone, addAmount, saleAmount, cardNo, vendorTxnId, existingVendorBalance } = input;
  if (addAmount <= 0) throw new ApiError(400, "INVALID_AMOUNT");
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
  return { event, earnAmount, availableBalance, customerId };
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
};

export async function bulkImportLegacyBalances(
  storeId: string,
  terminalId: string,
  entries: BulkImportEntry[]
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

  for (const [phone, { balance, cardNo }] of byPhone) {
    const user = await getOrCreateUserByPhone(phone);
    const customerId = String(user._id);
    // 이 포스기에서 이 고객 몫을 이미 가져왔으면 스킵(포스기 단위 — 같은 매장의 다른
    // 포스기에서 이미 실적립·다른 초기화가 있었어도 이 포스기 몫은 별도로 더해야 함).
    const canImport = await claimVendorImport(storeId, terminalId, customerId, balance, "BULK");
    if (!canImport) {
      alreadyLinked++;
      continue;
    }
    const account = await getOrCreateAccount(customerId, storeId, "STORE", companyId);
    await atomicCredit(account._id, balance);
    await PointEvent.create({
      userId: customerId,
      companyId,
      storeId,
      terminalId,
      cardNo,
      type: "VENDOR_IMPORT",
      amount: balance,
      status: "CONFIRMED",
      reason: `포스기 초기화 일괄 이전 (terminal ${terminalId})`,
    });
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

  return { imported, alreadyLinked, skippedInvalidPhone, totalAmount };
}

/**
 * 사용 팝업이 전화번호를 받았을 때 — 신규 손님이면 그 자리에서 계정을 만들고 가용 잔액(0원)을
 * 돌려준다. 같은 고객을 다른 포스기(다른 매장이든 같은 매장이든)에서 거의 동시에 조회해 각자
 * 화면에 띄운 뒤 각각 사용해버리면 서버 잔액은 하나인데 이중사용이 생길 수 있어(2026-09-28),
 * 조회 시점에 고객 단위로 잠근다 — 이미 다른 포스기가 조회 중이면 거부한다.
 */
export async function posAgentRedeemLookup(storeId: string, terminalId: string, phone: string) {
  const user = await getOrCreateUserByPhone(phone);
  const customerId = String(user._id);

  try {
    await RedeemLock.create({ userId: customerId, storeId, terminalId });
  } catch (e) {
    if ((e as { code?: number }).code === 11000) {
      throw new ApiError(409, "REDEEM_IN_PROGRESS_ELSEWHERE");
    }
    throw e;
  }

  const availableBalance = await getAvailableForStore(customerId, storeId);
  return { customerId, availableBalance, name: user.name };
}

export type AgentRedeemInput = {
  storeId: string;
  terminalId: string;
  phone: string;
  usedAmount: number;
  cardNo?: string;
  vendorTxnId: string;
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
    return { event, breakdown, availableBalance: await getAvailableForStore(customerId, storeId) };
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
