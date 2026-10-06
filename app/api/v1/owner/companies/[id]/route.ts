import { NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import { requireOwner } from "@/lib/rbac";
import AuditLog from "@/lib/models/AuditLog";
import { cleanName, assertCompanyNameFree, duplicateAs } from "@/lib/name-check";
import Company from "@/lib/models/Company";
import { handleApiError } from "@/lib/api-utils";

// 소유자: 고객사 이름 변경(이름은 표시용이라 언제든 바꿀 수 있다).
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await dbConnect();
    const session = await requireOwner();
    const { id } = await params;
    const { name } = await req.json();
    const trimmed = cleanName(name);
    if (!trimmed) return NextResponse.json({ error: "NAME_REQUIRED" }, { status: 400 });
    const before = await Company.findById(id).select("name").lean();
    if (!before) return NextResponse.json({ error: "COMPANY_NOT_FOUND" }, { status: 404 });
    await assertCompanyNameFree(trimmed, id);
    const company = await Company.findByIdAndUpdate(id, { name: trimmed }, { new: true }).catch((e) => duplicateAs(e, "COMPANY_NAME_IN_USE"));
    if (!company) return NextResponse.json({ error: "COMPANY_NOT_FOUND" }, { status: 404 });
    await AuditLog.create({ storeId: null, actorType: "HQ_ADMIN", actorId: session.sub, action: "COMPANY_RENAME", meta: { companyId: id, from: before.name, to: trimmed } });
    return NextResponse.json({ ok: true, company: { _id: String(company._id), name: company.name } });
  } catch (e) {
    return handleApiError(e);
  }
}
