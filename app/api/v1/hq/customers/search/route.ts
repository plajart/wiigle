import { NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import { requireCompanyAdmin, ApiError } from "@/lib/rbac";
import { resolveCompanyId } from "@/lib/company-context";
import { lookupCustomerByPhone, getCompanyPointSummary, hasCompanyRelation } from "@/lib/points";
import { handleApiError } from "@/lib/api-utils";

// 고객사 운영자(본사는 들어간 고객사 기준)가 전화번호로 고객을 찾아 상세(개별 이용내역) 화면으로 진입하기 위한 조회.
// 통합포인트는 고객사 단위이므로 **이 고객사에서 이용한 적이 있는 고객만** 조회된다(다른 고객사에서만 이용한 고객은
// 존재 여부도 알려주지 않는다). 잔액도 이 고객사 안의 것만 보여준다.
export async function GET(req: Request) {
  try {
    await dbConnect();
    const session = await requireCompanyAdmin();
    const companyId = await resolveCompanyId(session);
    if (!companyId) throw new ApiError(400, "COMPANY_REQUIRED");
    const phone = new URL(req.url).searchParams.get("phone") ?? "";
    if (!phone) return NextResponse.json({ error: "PHONE_REQUIRED" }, { status: 400 });

    const customer = await lookupCustomerByPhone(phone);
    if (!customer || !(await hasCompanyRelation(String(customer._id), companyId))) {
      return NextResponse.json({ error: "CUSTOMER_NOT_FOUND" }, { status: 404 });
    }

    const summary = await getCompanyPointSummary(String(customer._id), companyId);
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
