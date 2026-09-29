import { NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import { requireCompanyAdmin, ApiError } from "@/lib/rbac";
import { resolveCompanyId } from "@/lib/company-context";
import { getMyPointHistory, hasCompanyRelation } from "@/lib/points";
import { handleApiError } from "@/lib/api-utils";

// 이 고객사에서의 이용내역만 — 다른 고객사에서의 내역은 운영자에게 보이지 않는다.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await dbConnect();
    const session = await requireCompanyAdmin();
    const companyId = await resolveCompanyId(session);
    if (!companyId) throw new ApiError(400, "COMPANY_REQUIRED");
    const { id } = await params;
    if (!(await hasCompanyRelation(id, companyId))) {
      return NextResponse.json({ error: "CUSTOMER_NOT_FOUND" }, { status: 404 });
    }
    const events = await getMyPointHistory(id, companyId);
    return NextResponse.json({ events });
  } catch (e) {
    return handleApiError(e);
  }
}
