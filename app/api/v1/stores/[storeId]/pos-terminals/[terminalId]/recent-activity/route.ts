import { NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import { requireSession, assertStoreScope } from "@/lib/rbac";
import PointEvent from "@/lib/models/PointEvent";
import { handleApiError } from "@/lib/api-utils";

const EARN_TYPES = new Set(["EARN", "VENDOR_EARN", "VENDOR_IMPORT", "GRANT", "ADJUST"]);

// 매장 관리자: 특정 단말의 상세보기 — 그 단말에서 최근 발생한 적립·사용 20건.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ storeId: string; terminalId: string }> }
) {
  try {
    await dbConnect();
    const session = await requireSession();
    const { storeId, terminalId } = await params;
    await assertStoreScope(session, storeId);

    const events = await PointEvent.find({ storeId, terminalId }).sort({ occurredAt: -1 }).limit(20).lean();

    return NextResponse.json({
      events: events.map((e) => ({
        _id: String(e._id),
        type: e.type,
        isEarn: EARN_TYPES.has(e.type),
        amount: e.amount,
        occurredAt: e.occurredAt,
        cardNo: e.cardNo || null,
      })),
    });
  } catch (e) {
    return handleApiError(e);
  }
}
