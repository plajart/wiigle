import { NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import { requireOwner } from "@/lib/rbac";
import Company from "@/lib/models/Company";
import { handleApiError } from "@/lib/api-utils";

// 소유자: 고객사 이름 변경(이름은 표시용이라 언제든 바꿀 수 있다).
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await dbConnect();
    await requireOwner();
    const { id } = await params;
    const { name } = await req.json();
    const trimmed = typeof name === "string" ? name.trim() : "";
    if (!trimmed) return NextResponse.json({ error: "NAME_REQUIRED" }, { status: 400 });
    const company = await Company.findByIdAndUpdate(id, { name: trimmed }, { new: true });
    if (!company) return NextResponse.json({ error: "COMPANY_NOT_FOUND" }, { status: 404 });
    return NextResponse.json({ ok: true, company: { _id: String(company._id), name: company.name } });
  } catch (e) {
    return handleApiError(e);
  }
}
