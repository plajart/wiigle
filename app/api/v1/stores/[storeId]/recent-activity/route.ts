import { NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import { requireSession, assertStoreScope } from "@/lib/rbac";
import PointEvent from "@/lib/models/PointEvent";
import PosTransferLog from "@/lib/models/PosTransferLog";
import PosTerminal from "@/lib/models/PosTerminal";
import User from "@/lib/models/User";
import { handleApiError } from "@/lib/api-utils";

const mask = (p?: string) => (p && p.length >= 8 ? `${p.slice(0, 3)}-****-${p.slice(-4)}` : p ?? "");

// 매장 대시보드: 이 매장의 최근 포인트 거래(어느 포스기에서, 어느 고객이, 얼마, 언제 — 대표가 아닌 포스기 분 포함)와
// 포스기↔서버 포인트 이동 기록(오프라인 후 뒤늦은 반영 표시 포함).
export async function GET(_req: Request, { params }: { params: Promise<{ storeId: string }> }) {
  try {
    await dbConnect();
    const session = await requireSession();
    const { storeId } = await params;
    await assertStoreScope(session, storeId);

    const [events, transfers, terminals] = await Promise.all([
      PointEvent.find({ storeId }).sort({ occurredAt: -1 }).limit(30).lean(),
      PosTransferLog.find({ storeId }).sort({ recordedAt: -1 }).limit(30).lean(),
      PosTerminal.find({ storeId }).select("name").lean(),
    ]);
    const terminalName = new Map(terminals.map((t) => [String(t._id), t.name]));
    const userIds = [...new Set([...events.map((e) => String(e.userId)), ...transfers.filter((t) => t.userId).map((t) => String(t.userId))])];
    const users = await User.find({ _id: { $in: userIds } }).select("name phone").lean();
    const userInfo = new Map(users.map((u) => [String(u._id), { name: u.name, phone: mask(u.phone) }]));

    return NextResponse.json({
      events: events.map((e) => ({
        _id: String(e._id),
        type: e.type,
        amount: e.amount,
        occurredAt: e.occurredAt,
        recordedAt: e.recordedAt ?? null,
        offline: e.offline === true,
        terminalName: e.terminalId ? terminalName.get(String(e.terminalId)) ?? "(삭제된 포스기)" : null,
        customer: userInfo.get(String(e.userId)) ?? null,
        cardNo: e.cardNo || null,
      })),
      transfers: transfers.map((t) => ({
        _id: String(t._id),
        kind: t.kind,
        direction: t.direction,
        amount: t.amount,
        localBefore: t.localBefore ?? null,
        localAfter: t.localAfter ?? null,
        serverBalanceAfter: t.serverBalanceAfter ?? null,
        occurredAt: t.occurredAt,
        recordedAt: t.recordedAt,
        delaySec: t.delaySec ?? null,
        offline: t.offline === true,
        note: t.note ?? null,
        terminalName: t.terminalId ? terminalName.get(String(t.terminalId)) ?? "(삭제된 포스기)" : null,
        customer: t.userId ? userInfo.get(String(t.userId)) ?? null : null,
      })),
    });
  } catch (e) {
    return handleApiError(e);
  }
}
