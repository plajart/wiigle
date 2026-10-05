import { NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import { requireSession, assertStoreScope } from "@/lib/rbac";
import PointEvent from "@/lib/models/PointEvent";
import PosTerminal from "@/lib/models/PosTerminal";
import { handleApiError } from "@/lib/api-utils";

const EARN_TYPES = ["EARN", "VENDOR_EARN", "VENDOR_IMPORT", "GRANT", "ADJUST"];
const USE_TYPES = ["REDEEM", "VENDOR_USE"];
// 결제 취소로 되돌려진 건 — 총 적립/사용에서 빼서 정산이 실제와 맞게 한다.
const EARN_CANCEL_TYPES = ["EARN_CANCEL"];
const USE_CANCEL_TYPES = ["USE_CANCEL"];

// 매장 관리자: 특정 날짜(KST)의 일일 정산 — 매장 내 모든 POS 단말을 합친 총 적립/사용 +
// 단말별 소계 + 개별 거래 상세. 날짜는 캘린더(달력 입력)로 고른 하루(YYYY-MM-DD, KST 기준).
export async function GET(req: Request, { params }: { params: Promise<{ storeId: string }> }) {
  try {
    await dbConnect();
    const session = await requireSession();
    const { storeId } = await params;
    await assertStoreScope(session, storeId);

    const url = new URL(req.url);
    const dateStr = url.searchParams.get("date") || new Date().toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return NextResponse.json({ error: "INVALID_DATE" }, { status: 400 });

    // KST(UTC+9) 기준 그 날짜의 00:00~24:00을 UTC 범위로 환산
    const start = new Date(`${dateStr}T00:00:00+09:00`);
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);

    const events = await PointEvent.find({
      storeId,
      occurredAt: { $gte: start, $lt: end },
    })
      .sort({ occurredAt: -1 })
      .lean();

    const terminals = await PosTerminal.find({ storeId }).lean();
    const terminalName = new Map(terminals.map((t) => [String(t._id), t.name]));

    let totalEarned = 0;
    let totalUsed = 0;
    const byTerminal = new Map<string, { terminalId: string; name: string; earned: number; used: number; count: number }>();

    const detail = events.map((e) => {
      const isEarn = EARN_TYPES.includes(e.type);
      const isUse = USE_TYPES.includes(e.type);
      const earnDelta = isEarn ? e.amount : EARN_CANCEL_TYPES.includes(e.type) ? -e.amount : 0;
      const useDelta = isUse ? e.amount : USE_CANCEL_TYPES.includes(e.type) ? -e.amount : 0;
      totalEarned += earnDelta;
      totalUsed += useDelta;

      const tid = e.terminalId ? String(e.terminalId) : "WEB"; // terminalId 없는 이벤트(웹/관리모드 조작 등)는 "WEB"으로 묶음
      const bucket = byTerminal.get(tid) ?? { terminalId: tid, name: terminalName.get(tid) || "웹/관리모드", earned: 0, used: 0, count: 0 };
      bucket.earned += earnDelta;
      bucket.used += useDelta;
      bucket.count += 1;
      byTerminal.set(tid, bucket);

      return {
        _id: String(e._id),
        type: e.type,
        amount: e.amount,
        occurredAt: e.occurredAt,
        terminalId: e.terminalId ? String(e.terminalId) : null,
        terminalName: terminalName.get(tid) || (e.terminalId ? "해지된 단말" : "웹/관리모드"),
        cardNo: e.cardNo || null,
        reason: e.reason || null,
      };
    });

    return NextResponse.json({
      date: dateStr,
      totalEarned,
      totalUsed,
      count: events.length,
      byTerminal: Array.from(byTerminal.values()).sort((a, b) => b.count - a.count),
      detail,
    });
  } catch (e) {
    return handleApiError(e);
  }
}
