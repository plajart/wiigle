import { NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import { requireHqAdmin } from "@/lib/rbac";
import { grantHqPoints, lookupCustomerByPhone } from "@/lib/points";
import { handleApiError } from "@/lib/api-utils";

export async function POST(req: Request) {
  try {
    await dbConnect();
    const session = await requireHqAdmin();
    const { customerPhone, amount, reason } = await req.json();
    if (!customerPhone || !amount) return NextResponse.json({ error: "MISSING_FIELDS" }, { status: 400 });

    const customer = await lookupCustomerByPhone(customerPhone);
    if (!customer) return NextResponse.json({ error: "CUSTOMER_NOT_FOUND" }, { status: 404 });

    await grantHqPoints(String(customer._id), Number(amount), reason ?? "", session.sub);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return handleApiError(e);
  }
}
