import { NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import { requireCompanyAdmin, assertStoreScope } from "@/lib/rbac";
import Store from "@/lib/models/Store";
import AuditLog from "@/lib/models/AuditLog";
import { handleApiError } from "@/lib/api-utils";

// 고객사 운영자(본사 포함): 자기 고객사 매장의 이름 변경. 이름은 표시용이라 언제든 바꿀 수 있다.
export async function PATCH(req: Request, { params }: { params: Promise<{ storeId: string }> }) {
  try {
    await dbConnect();
    const session = await requireCompanyAdmin();
    const { storeId } = await params;
    await assertStoreScope(session, storeId);
    const { name } = await req.json().catch(() => ({}));
    const trimmed = typeof name === "string" ? name.trim().slice(0, 100) : "";
    if (!trimmed) return NextResponse.json({ error: "NAME_REQUIRED" }, { status: 400 });
    const before = await Store.findById(storeId).select("name").lean();
    const store = await Store.findByIdAndUpdate(storeId, { name: trimmed }, { new: true });
    if (!store) return NextResponse.json({ error: "STORE_NOT_FOUND" }, { status: 404 });
    await AuditLog.create({ storeId: store._id, actorType: "HQ_ADMIN", actorId: session.sub, action: "STORE_RENAME", meta: { from: before?.name, to: trimmed } });
    return NextResponse.json({ ok: true, store: { _id: String(store._id), name: store.name } });
  } catch (e) {
    return handleApiError(e);
  }
}
