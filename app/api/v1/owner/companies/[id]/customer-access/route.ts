import { NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import { requireOwner } from "@/lib/rbac";
import Company from "@/lib/models/Company";
import AuditLog from "@/lib/models/AuditLog";
import { handleApiError } from "@/lib/api-utils";

// 본사: 고객사별 "고객 웹 조회" 열기/닫기. 닫으면 그 고객사에서만 이용한 고객은 웹 로그인이 막히고,
// 여러 고객사를 이용한 고객도 닫힌 고객사의 포인트는 웹에 보이지 않는다(포스·적립·사용에는 영향 없음).
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await dbConnect();
    const session = await requireOwner();
    const { id } = await params;
    const { enabled } = await req.json();
    if (typeof enabled !== "boolean") return NextResponse.json({ error: "ENABLED_REQUIRED" }, { status: 400 });
    const company = await Company.findByIdAndUpdate(id, { customerWebEnabled: enabled }, { new: true });
    if (!company) return NextResponse.json({ error: "COMPANY_NOT_FOUND" }, { status: 404 });
    await AuditLog.create({ storeId: null, actorType: "HQ_ADMIN", actorId: session.sub, action: enabled ? "CUSTOMER_WEB_OPEN" : "CUSTOMER_WEB_CLOSE", meta: { companyId: String(company._id), companyName: company.name } });
    return NextResponse.json({ ok: true, enabled });
  } catch (e) {
    return handleApiError(e);
  }
}
