import { NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import { requireOwnStore } from "@/lib/rbac";
import { posEarn, lookupCustomerByPhone } from "@/lib/points";
import { handleApiError } from "@/lib/api-utils";

// 계산원이 POS 앱에서 고객을 매칭한 뒤, 적립할 포인트를 직접 입력해 그 자리에서 적립을 확정한다(수동 보조 수단).
export async function POST(req: Request) {
  try {
    await dbConnect();
    const session = await requireOwnStore();
    const { customerPhone, earnAmount, clientTxnId } = await req.json();
    if (!customerPhone || !earnAmount) return NextResponse.json({ error: "MISSING_FIELDS" }, { status: 400 });

    const customer = await lookupCustomerByPhone(customerPhone);
    if (!customer) return NextResponse.json({ error: "CUSTOMER_NOT_FOUND" }, { status: 404 });

    const result = await posEarn(session.storeManagerOf, String(customer._id), Number(earnAmount), session.sub, clientTxnId);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return handleApiError(e);
  }
}
