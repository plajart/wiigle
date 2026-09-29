import { NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import { requireOwnStore } from "@/lib/rbac";
import { posCheckout, lookupCustomerByPhone } from "@/lib/points";
import { handleApiError } from "@/lib/api-utils";

export async function POST(req: Request) {
  try {
    await dbConnect();
    const session = await requireOwnStore();
    const { customerPhone, amount, clientTxnId } = await req.json();
    if (!customerPhone || !amount) return NextResponse.json({ error: "MISSING_FIELDS" }, { status: 400 });

    const customer = await lookupCustomerByPhone(customerPhone);
    if (!customer) return NextResponse.json({ error: "CUSTOMER_NOT_FOUND" }, { status: 404 });

    const result = await posCheckout(session.storeManagerOf, String(customer._id), Number(amount), session.sub, clientTxnId);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return handleApiError(e);
  }
}
