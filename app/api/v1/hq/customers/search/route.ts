import { NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import { requireCompanyAdmin } from "@/lib/rbac";
import { lookupCustomerByPhone, getMyPointSummary } from "@/lib/points";
import { handleApiError } from "@/lib/api-utils";

// 운영자(또는 소유자)가 전화번호로 고객을 찾아 상세(개별 이용내역) 화면으로 진입하기 위한 조회.
export async function GET(req: Request) {
  try {
    await dbConnect();
    await requireCompanyAdmin();
    const phone = new URL(req.url).searchParams.get("phone") ?? "";
    if (!phone) return NextResponse.json({ error: "PHONE_REQUIRED" }, { status: 400 });

    const customer = await lookupCustomerByPhone(phone);
    if (!customer) return NextResponse.json({ error: "CUSTOMER_NOT_FOUND" }, { status: 404 });

    const summary = await getMyPointSummary(String(customer._id));
    return NextResponse.json({
      customerId: String(customer._id),
      name: customer.name,
      phone: customer.phone,
      total: summary.total,
    });
  } catch (e) {
    return handleApiError(e);
  }
}
