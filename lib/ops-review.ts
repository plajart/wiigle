import "server-only";
import { Types } from "mongoose";
import { dbConnect } from "./mongodb";
import Company from "./models/Company";
import Store from "./models/Store";
import PosTerminal from "./models/PosTerminal";
import PointAccount from "./models/PointAccount";
import PointEvent from "./models/PointEvent";
import PosTransferLog from "./models/PosTransferLog";
import AuditLog from "./models/AuditLog";
import RedeemLock from "./models/RedeemLock";
import ImportHold from "./models/ImportHold";
import User from "./models/User";
import { getAgentBundle } from "./agent-bundle";
import { getOpsSwitches } from "./ops-switches";
import { lookupCustomerByPhone } from "./points";

// 본사 관리모드 "운영 점검·복구" — 읽기 전용 점검 화면의 데이터. 조치(되돌리기·보정·보류 처리 등)는 lib/ops-actions.ts.

const ONLINE_MS = 3 * 60 * 1000; // 하트비트가 이 안에 왔으면 연결됨
const OFFLINE_WARN_MS = 10 * 60 * 1000; // 이 이상 소식이 없으면 확인 필요
const STUCK_SWAP_MS = 20 * 60 * 1000; // 사용 조회로 포스에 반영해 둔 값이 이 시간이 지나도 되돌림 기록이 없으면 확인 필요
const REDEEM_LOCK_EXTRA_MS = 400_000; // lib/points.ts 의 조회 잠금 연장분(lockedAt 을 미래로 둠)과 같은 값

export type OpsIssueLevel = "critical" | "warn";

function oid(v: unknown): string {
  return v ? String(v) : "";
}

export async function getOpsReview(opts: { companyId?: string; storeId?: string; hours?: number }) {
  await dbConnect();
  const hours = Math.min(Math.max(Number(opts.hours) || 24, 1), 24 * 14);
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);
  const now = Date.now();

  const storeFilter: Record<string, unknown> = {};
  if (opts.storeId) storeFilter._id = opts.storeId;
  else if (opts.companyId) storeFilter.companyId = opts.companyId;
  const [companies, stores] = await Promise.all([Company.find().select("name").sort({ name: 1 }).lean(), Store.find(storeFilter).select("name companyId").sort({ name: 1 }).lean()]);
  const companyName = new Map(companies.map((c) => [oid(c._id), c.name as string]));
  const storeName = new Map(stores.map((s) => [oid(s._id), s.name as string]));
  const storeCompany = new Map(stores.map((s) => [oid(s._id), oid(s.companyId)]));
  const storeIds = stores.map((s) => s._id);
  const inScope = { storeId: { $in: storeIds } };

  let expectedVersion: string | null = null;
  try {
    expectedVersion = (await getAgentBundle()).version;
  } catch {
    // 버전 확인 실패는 점검을 막지 않는다
  }

  const [terminals, eventTypes, offlineEvents, transferIssues, shortfalls, negativeAccounts, holds, locks, stuckLogs, switches] = await Promise.all([
    PosTerminal.find({ ...inScope, status: "ACTIVE" }).sort({ storeId: 1, name: 1 }).lean(),
    PointEvent.aggregate([{ $match: { ...inScope, occurredAt: { $gte: since } } }, { $group: { _id: "$type", n: { $sum: 1 }, amount: { $sum: "$amount" } } }]),
    PointEvent.countDocuments({ ...inScope, occurredAt: { $gte: since }, offline: true }),
    PosTransferLog.find({ ...inScope, recordedAt: { $gte: since }, kind: { $in: ["REJECTED", "SKIPPED"] } }).sort({ recordedAt: -1 }).limit(60).lean(),
    AuditLog.find({ ...inScope, action: "VENDOR_USE_SHORTFALL", occurredAt: { $gte: since } }).sort({ occurredAt: -1 }).limit(60).lean(),
    PointAccount.find({ storeId: { $in: [...storeIds, null] }, ...(opts.storeId ? {} : opts.companyId ? { companyId: opts.companyId } : {}), balance: { $lt: 0 } })
      .sort({ balance: 1 })
      .limit(100)
      .lean(),
    ImportHold.find({ ...inScope, status: "OPEN" }).sort({ createdAt: -1 }).limit(200).lean(),
    RedeemLock.find(inScope).limit(100).lean(),
    PosTransferLog.find({ ...inScope, recordedAt: { $gte: new Date(now - 6 * 60 * 60 * 1000) }, kind: { $in: ["LOOKUP_TO_POS", "RESTORE_POS"] } })
      .sort({ recordedAt: 1 })
      .limit(5000)
      .select("terminalId userId kind recordedAt storeId phone amount")
      .lean(),
    getOpsSwitches(),
  ]);

  // 사용자 정보(전화번호·이름)를 한 번에 가져온다.
  const userIds = new Set<string>();
  for (const x of [...transferIssues, ...negativeAccounts, ...holds, ...locks]) if (x.userId) userIds.add(oid(x.userId));
  for (const a of shortfalls) {
    const cid = (a.meta as { customerId?: string } | undefined)?.customerId;
    if (cid) userIds.add(String(cid));
  }
  const users = await User.find({ _id: { $in: [...userIds] } }).select("name phone").lean();
  const userInfo = new Map(users.map((u) => [oid(u._id), { name: (u.name as string | undefined) ?? "", phone: (u.phone as string | undefined) ?? "" }]));
  const termName = new Map(terminals.map((t) => [oid(t._id), t.name as string]));
  const nameOfTerminal = async (ids: string[]) => {
    const missing = ids.filter((id) => id && !termName.has(id));
    if (!missing.length) return;
    const rows = await PosTerminal.find({ _id: { $in: missing } }).select("name").lean();
    for (const r of rows) termName.set(oid(r._id), r.name as string);
  };
  await nameOfTerminal([...new Set([...transferIssues, ...holds].map((x) => oid(x.terminalId)))]);

  const terminalRows = terminals.map((t) => {
    const lastSeen = t.lastSeenAt ? new Date(t.lastSeenAt).getTime() : 0;
    const age = lastSeen ? now - lastSeen : Infinity;
    const st = (t.agentStatus ?? {}) as { pending?: number; skippedNoPhone?: number; lastError?: string | null; lastErrorAt?: Date | null; autoInject?: boolean; swapPending?: number; reportedAt?: Date };
    const flags: { level: OpsIssueLevel; text: string }[] = [];
    if (age > OFFLINE_WARN_MS) flags.push({ level: "warn", text: lastSeen ? `${Math.round(age / 60000)}분째 소식 없음(꺼졌거나 인터넷 끊김)` : "한 번도 연결된 적 없음" });
    if (st.lastError) flags.push({ level: "warn", text: `최근 오류: ${st.lastError}` });
    if ((st.pending ?? 0) > 0) flags.push({ level: "warn", text: `서버에 아직 못 보낸 결제 ${st.pending}건` });
    if ((st.skippedNoPhone ?? 0) > 0) flags.push({ level: "warn", text: `전화번호 없는 회원의 결제 ${st.skippedNoPhone}건 보류` });
    if (expectedVersion && t.agentVersion && t.agentVersion !== expectedVersion) flags.push({ level: "warn", text: "프로그램이 최신 버전이 아님" });
    if (!t.initialTransferAt) flags.push({ level: "warn", text: "최초 포인트 서버 이전 전" });
    return {
      _id: oid(t._id),
      name: t.name as string,
      storeId: oid(t.storeId),
      storeName: storeName.get(oid(t.storeId)) ?? "",
      companyName: companyName.get(storeCompany.get(oid(t.storeId)) ?? "") ?? "",
      online: age <= ONLINE_MS,
      lastSeenAt: t.lastSeenAt ?? null,
      agentVersion: t.agentVersion ?? null,
      isLatest: !!expectedVersion && t.agentVersion === expectedVersion,
      autoInject: st.autoInject ?? null,
      swapPending: st.swapPending ?? 0,
      pending: st.pending ?? 0,
      initialTransferAt: t.initialTransferAt ?? null,
      flags,
    };
  });

  // 반영해 둔 값이 되돌려지지 않은 채 오래 남은 건 — (포스기, 고객) 별로 마지막 LOOKUP_TO_POS 가 마지막 RESTORE_POS 보다 늦고 STUCK_SWAP_MS 이상 지난 것.
  const lastLookup = new Map<string, { at: number; storeId: string; terminalId: string; userId: string; phone?: string; amount: number }>();
  const lastRestore = new Map<string, number>();
  for (const l of stuckLogs) {
    const key = `${oid(l.terminalId)}|${oid(l.userId)}`;
    const at = new Date(l.recordedAt).getTime();
    if (l.kind === "LOOKUP_TO_POS") lastLookup.set(key, { at, storeId: oid(l.storeId), terminalId: oid(l.terminalId), userId: oid(l.userId), phone: l.phone, amount: l.amount ?? 0 });
    else lastRestore.set(key, at);
  }
  const stuck = [...lastLookup.entries()]
    .filter(([key, v]) => (lastRestore.get(key) ?? 0) < v.at && now - v.at > STUCK_SWAP_MS)
    .map(([, v]) => v)
    .slice(0, 50);
  await nameOfTerminal(stuck.map((v) => v.terminalId));
  {
    const need = stuck.map((v) => v.userId).filter((id) => id && !userInfo.has(id));
    if (need.length) {
      const rows = await User.find({ _id: { $in: need } }).select("name phone").lean();
      for (const u of rows) userInfo.set(oid(u._id), { name: (u.name as string | undefined) ?? "", phone: (u.phone as string | undefined) ?? "" });
    }
  }

  const issues = {
    importHolds: holds.map((h) => ({
      _id: oid(h._id),
      kind: h.kind,
      storeId: oid(h.storeId),
      storeName: storeName.get(oid(h.storeId)) ?? "",
      terminalName: termName.get(oid(h.terminalId)) ?? "(삭제된 포스기)",
      phone: h.phone,
      customerName: userInfo.get(oid(h.userId))?.name ?? "",
      balance: h.balance,
      amount: h.amount,
      previous: h.previous,
      createdAt: h.createdAt,
      lastSeenAt: h.lastSeenAt,
    })),
    negativeAccounts: negativeAccounts.map((a) => ({
      _id: oid(a._id),
      userId: oid(a.userId),
      phone: userInfo.get(oid(a.userId))?.phone ?? "",
      customerName: userInfo.get(oid(a.userId))?.name ?? "",
      storeId: a.storeId ? oid(a.storeId) : null,
      storeName: a.storeId ? storeName.get(oid(a.storeId)) ?? "" : "통합포인트",
      companyName: companyName.get(oid(a.companyId)) ?? "",
      balance: a.balance,
    })),
    shortfalls: shortfalls.map((a) => {
      const meta = (a.meta ?? {}) as { customerId?: string; amount?: number; vendorTxnId?: string };
      return {
        _id: oid(a._id),
        occurredAt: a.occurredAt,
        storeName: storeName.get(oid(a.storeId)) ?? "",
        terminalName: termName.get(oid(a.actorId)) ?? "",
        phone: userInfo.get(String(meta.customerId ?? ""))?.phone ?? "",
        amount: meta.amount ?? 0,
        vendorTxnId: meta.vendorTxnId ?? "",
      };
    }),
    rejectedOrSkipped: transferIssues.map((t) => ({
      _id: oid(t._id),
      kind: t.kind,
      recordedAt: t.recordedAt,
      storeName: storeName.get(oid(t.storeId)) ?? "",
      terminalName: termName.get(oid(t.terminalId)) ?? "",
      phone: t.phone ?? "",
      amount: t.amount,
      note: t.note ?? "",
    })),
    stuckSwaps: stuck.map((v) => ({
      storeName: storeName.get(v.storeId) ?? "",
      terminalName: termName.get(v.terminalId) ?? "",
      userId: v.userId,
      phone: userInfo.get(v.userId)?.phone ?? v.phone ?? "",
      amount: v.amount,
      minutesAgo: Math.round((now - v.at) / 60000),
    })),
    locks: locks.map((l) => {
      const fromTerminal = !!l.terminalId;
      const heldMs = now - (new Date(l.lockedAt).getTime() - (fromTerminal ? REDEEM_LOCK_EXTRA_MS : 0));
      return {
        userId: oid(l.userId),
        phone: userInfo.get(oid(l.userId))?.phone ?? "",
        storeName: storeName.get(oid(l.storeId)) ?? "",
        terminalName: l.terminalId ? termName.get(oid(l.terminalId)) ?? "" : "웹 관리모드",
        heldSec: Math.max(0, Math.round(heldMs / 1000)),
      };
    }),
  };

  const critical = issues.importHolds.length + issues.negativeAccounts.length + issues.shortfalls.length + issues.stuckSwaps.length;
  const warn = issues.rejectedOrSkipped.length + terminalRows.filter((t) => t.flags.length > 0).length;

  return {
    generatedAt: new Date().toISOString(),
    hours,
    expectedVersion,
    switches,
    options: {
      companies: companies.map((c) => ({ _id: oid(c._id), name: c.name as string })),
      stores: stores.map((s) => ({ _id: oid(s._id), name: s.name as string, companyId: oid(s.companyId) })),
    },
    summary: {
      critical,
      warn,
      terminals: terminalRows.length,
      online: terminalRows.filter((t) => t.online).length,
      offlineDelayedEvents: offlineEvents,
      events: eventTypes.map((e) => ({ type: String(e._id), count: e.n as number, amount: e.amount as number })),
    },
    terminals: terminalRows,
    issues,
  };
}

/** 전화번호 한 명의 계좌·최근 내역·이동 기록·잠금·보류 — 본사가 문제 고객을 조사하고 조치할 때 쓴다. */
export async function getCustomerOps(phone: string) {
  await dbConnect();
  const user = await lookupCustomerByPhone(phone);
  if (!user) return null;
  const userId = oid(user._id);
  const [accounts, events, transfers, lock, holds] = await Promise.all([
    PointAccount.find({ userId }).lean(),
    PointEvent.find({ userId }).sort({ occurredAt: -1 }).limit(120).lean(),
    PosTransferLog.find({ userId }).sort({ recordedAt: -1 }).limit(80).lean(),
    RedeemLock.findOne({ userId }).lean(),
    ImportHold.find({ userId }).sort({ createdAt: -1 }).limit(30).lean(),
  ]);
  const storeIds = new Set<string>();
  const companyIds = new Set<string>();
  const terminalIds = new Set<string>();
  for (const a of accounts) {
    if (a.storeId) storeIds.add(oid(a.storeId));
    companyIds.add(oid(a.companyId));
  }
  for (const e of events) {
    if (e.storeId) storeIds.add(oid(e.storeId));
    if (e.terminalId) terminalIds.add(oid(e.terminalId));
  }
  for (const t of transfers) {
    storeIds.add(oid(t.storeId));
    if (t.terminalId) terminalIds.add(oid(t.terminalId));
  }
  for (const h of holds) {
    storeIds.add(oid(h.storeId));
    terminalIds.add(oid(h.terminalId));
  }
  if (lock) {
    storeIds.add(oid(lock.storeId));
    if (lock.terminalId) terminalIds.add(oid(lock.terminalId));
  }
  const [stores, terminals] = await Promise.all([Store.find({ _id: { $in: [...storeIds].map((i) => new Types.ObjectId(i)) } }).select("name companyId").lean(), PosTerminal.find({ _id: { $in: [...terminalIds].map((i) => new Types.ObjectId(i)) } }).select("name").lean()]);
  for (const s of stores) companyIds.add(oid(s.companyId));
  const companies = await Company.find({ _id: { $in: [...companyIds].map((i) => new Types.ObjectId(i)) } }).select("name").lean();
  const sName = new Map(stores.map((s) => [oid(s._id), s.name as string]));
  const sCompany = new Map(stores.map((s) => [oid(s._id), oid(s.companyId)]));
  const tName = new Map(terminals.map((t) => [oid(t._id), t.name as string]));
  const cName = new Map(companies.map((c) => [oid(c._id), c.name as string]));

  return {
    user: { _id: userId, name: (user.name as string | undefined) ?? "", phone: (user.phone as string | undefined) ?? "", role: user.role as string },
    accounts: accounts.map((a) => ({
      _id: oid(a._id),
      type: a.type,
      companyId: oid(a.companyId),
      companyName: cName.get(oid(a.companyId)) ?? "",
      storeId: a.storeId ? oid(a.storeId) : null,
      storeName: a.storeId ? sName.get(oid(a.storeId)) ?? "" : "통합포인트",
      balance: a.balance,
    })),
    events: events.map((e) => ({
      _id: oid(e._id),
      type: e.type,
      amount: e.amount,
      status: e.status,
      occurredAt: e.occurredAt,
      recordedAt: e.recordedAt ?? null,
      offline: e.offline === true,
      companyName: cName.get(oid(e.companyId) || sCompany.get(oid(e.storeId)) || "") ?? "",
      storeId: e.storeId ? oid(e.storeId) : null,
      storeName: e.storeId ? sName.get(oid(e.storeId)) ?? "" : "통합포인트",
      terminalName: e.terminalId ? tName.get(oid(e.terminalId)) ?? "(삭제된 포스기)" : null,
      reason: e.reason ?? "",
      vendorTxnId: e.vendorTxnId ?? "",
      reversedBy: e.reversedBy ? oid(e.reversedBy) : null,
      reversalOf: e.reversalOf ? oid(e.reversalOf) : null,
    })),
    transfers: transfers.map((t) => ({
      _id: oid(t._id),
      kind: t.kind,
      amount: t.amount,
      recordedAt: t.recordedAt,
      storeName: sName.get(oid(t.storeId)) ?? "",
      terminalName: t.terminalId ? tName.get(oid(t.terminalId)) ?? "" : "",
      localBefore: t.localBefore ?? null,
      localAfter: t.localAfter ?? null,
      serverBalanceAfter: t.serverBalanceAfter ?? null,
      note: t.note ?? "",
    })),
    lock: lock ? { storeName: sName.get(oid(lock.storeId)) ?? "", terminalName: lock.terminalId ? tName.get(oid(lock.terminalId)) ?? "" : "웹 관리모드", lockedAt: lock.lockedAt } : null,
    holds: holds.map((h) => ({
      _id: oid(h._id),
      kind: h.kind,
      status: h.status,
      storeName: sName.get(oid(h.storeId)) ?? "",
      terminalName: tName.get(oid(h.terminalId)) ?? "",
      balance: h.balance,
      amount: h.amount,
      previous: h.previous,
      createdAt: h.createdAt,
    })),
  };
}

function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? "" : v instanceof Date ? v.toISOString() : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function csv(rows: unknown[][]): string {
  return "﻿" + rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

/** 고객사(또는 전체) 원장 내보내기 — 도입·보정 전후 백업/대조용. accounts: 계좌별 잔액, events: 기간 내 모든 내역. */
export async function exportLedgerCsv(opts: { kind: "accounts" | "events"; companyId?: string; days?: number }): Promise<string> {
  await dbConnect();
  const companyFilter = opts.companyId ? { companyId: opts.companyId } : {};
  const companies = await Company.find().select("name").lean();
  const stores = await Store.find().select("name companyId").lean();
  const cName = new Map(companies.map((c) => [oid(c._id), c.name as string]));
  const sName = new Map(stores.map((s) => [oid(s._id), s.name as string]));
  const tRows = await PosTerminal.find().select("name").lean();
  const tName = new Map(tRows.map((t) => [oid(t._id), t.name as string]));

  if (opts.kind === "accounts") {
    const accounts = await PointAccount.find(companyFilter).lean();
    const users = await User.find({ _id: { $in: accounts.map((a) => a.userId) } }).select("name phone").lean();
    const u = new Map(users.map((x) => [oid(x._id), x]));
    return csv([
      ["고객사", "구분", "매장", "전화번호", "이름", "잔액", "계좌ID", "고객ID"],
      ...accounts.map((a) => [cName.get(oid(a.companyId)) ?? "", a.type === "HQ" ? "통합포인트" : "매장", a.storeId ? sName.get(oid(a.storeId)) ?? "" : "", u.get(oid(a.userId))?.phone ?? "", u.get(oid(a.userId))?.name ?? "", a.balance, oid(a._id), oid(a.userId)]),
    ]);
  }
  const days = Math.min(Math.max(Number(opts.days) || 30, 1), 365);
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const events = await PointEvent.find({ ...companyFilter, occurredAt: { $gte: since } }).sort({ occurredAt: 1 }).limit(200000).lean();
  const users = await User.find({ _id: { $in: [...new Set(events.map((e) => oid(e.userId)))] } }).select("name phone").lean();
  const u = new Map(users.map((x) => [oid(x._id), x]));
  return csv([
    ["발생시각", "서버기록시각", "고객사", "매장", "포스기", "전화번호", "종류", "금액", "상태", "오프라인후반영", "사유", "거래키", "내역ID", "되돌림 대상ID", "되돌려진 내역ID"],
    ...events.map((e) => [
      e.occurredAt,
      e.recordedAt ?? "",
      cName.get(oid(e.companyId)) ?? "",
      e.storeId ? sName.get(oid(e.storeId)) ?? "" : "통합포인트",
      e.terminalId ? tName.get(oid(e.terminalId)) ?? "" : "",
      u.get(oid(e.userId))?.phone ?? "",
      e.type,
      e.amount,
      e.status,
      e.offline ? "Y" : "",
      e.reason ?? "",
      e.vendorTxnId ?? "",
      oid(e._id),
      oid(e.reversalOf),
      oid(e.reversedBy),
    ]),
  ]);
}
