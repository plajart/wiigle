import { NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import { requireHqAdmin } from "@/lib/rbac";
import { adjustHqPoints, lookupCustomerByPhone } from "@/lib/points";
import { handleApiError } from "@/lib/api-utils";

export async function POST(req: Request) {
  try {
    await dbConnect();
    const session = await requireHqAdmin();
    const { customerPhone, delta, reason } = await req.json();
    if (!customerPhone || delta === undefined) {
      return NextResponse.json({ error: "MISSING_FIELDS" }, { status: 400 });
    }

    const customer = await lookupCustomerByPhone(customerPhone);
    if (!customer) return NextResponse.json({ error: "CUSTOMER_NOT_FOUND" }, { status: 404 });

    await adjustHqPoints(String(customer._id), Number(delta), reason ?? "", session.sub);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return handleApiError(e);
  }
}
