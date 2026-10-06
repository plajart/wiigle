import { assertManualPointChangesAllowed } from "@/lib/manual-points";
import { NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import { requireCompanyAdmin, ApiError } from "@/lib/rbac";
import { resolveCompanyId } from "@/lib/company-context";
import { grantHqPoints, lookupCustomerByPhone, hasCompanyRelation } from "@/lib/points";
import { handleApiError } from "@/lib/api-utils";

export async function POST(req: Request) {
  try {
    assertManualPointChangesAllowed(); // 챔프 외 임의 포인트 변경은 기본으로 막는다
    await dbConnect();
    const session = await requireCompanyAdmin();
    // 통합포인트는 고객사 단위 — 지급·조정은 현재(들어가 있는) 고객사의 통합포인트에만 반영된다.
    const companyId = await resolveCompanyId(session);
    if (!companyId) throw new ApiError(400, "COMPANY_REQUIRED");
    const { customerPhone, amount, reason } = await req.json();
    if (!customerPhone || !amount) return NextResponse.json({ error: "MISSING_FIELDS" }, { status: 400 });

    const customer = await lookupCustomerByPhone(customerPhone);
    if (!customer) return NextResponse.json({ error: "CUSTOMER_NOT_FOUND" }, { status: 404 });

    await grantHqPoints(String(customer._id), companyId, Number(amount), reason ?? "", session.sub);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return handleApiError(e);
  }
}
