import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/rbac";
import { getCustomerOps } from "@/lib/ops-review";
import { handleApiError } from "@/lib/api-utils";

// 본사: 고객 한 명(전화번호)의 계좌·최근 내역·포스 이동 기록·잠금·보류 건.
export async function GET(req: Request) {
  try {
    await requireOwner();
    const phone = (new URL(req.url).searchParams.get("phone") || "").replace(/[^0-9]/g, "");
    if (phone.length < 9) return NextResponse.json({ error: "PHONE_REQUIRED" }, { status: 400 });
    const data = await getCustomerOps(phone);
    if (!data) return NextResponse.json({ error: "CUSTOMER_NOT_FOUND" }, { status: 404 });
    return NextResponse.json(data);
  } catch (e) {
    return handleApiError(e);
  }
}
