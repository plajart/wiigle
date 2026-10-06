import { assertManualPointChangesAllowed } from "@/lib/manual-points";
import { NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import { requireOwnStore } from "@/lib/rbac";
import { posCheckout, lookupCustomerByPhone, RedeemBusyError } from "@/lib/points";
import { handleApiError } from "@/lib/api-utils";

export async function POST(req: Request) {
  try {
    await assertManualPointChangesAllowed(); // 챔프 외 임의 포인트 변경은 본사가 켜기 전까지 막는다
    await dbConnect();
    const session = await requireOwnStore();
    const { customerPhone, amount, clientTxnId } = await req.json();
    if (!customerPhone || !amount) return NextResponse.json({ error: "MISSING_FIELDS" }, { status: 400 });

    const customer = await lookupCustomerByPhone(customerPhone);
    if (!customer) return NextResponse.json({ error: "CUSTOMER_NOT_FOUND" }, { status: 404 });

    const result = await posCheckout(session.storeManagerOf, String(customer._id), Number(amount), session.sub, clientTxnId, session.role);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    if (e instanceof RedeemBusyError) return NextResponse.json({ error: "REDEEM_IN_PROGRESS_ELSEWHERE", holder: e.holder }, { status: 409 });
    return handleApiError(e);
  }
}
