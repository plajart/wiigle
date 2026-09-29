import { NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import { requireHqAdmin } from "@/lib/rbac";
import Store from "@/lib/models/Store";
import AuditLog from "@/lib/models/AuditLog";
import { handleApiError } from "@/lib/api-utils";

// 본사 관리자: 매장의 실제 벤더 POS Agent API 연결정보 등록 (호스트/포트, API 키)
export async function PUT(req: Request, { params }: { params: Promise<{ storeId: string }> }) {
  try {
    await dbConnect();
    const session = await requireHqAdmin();
    const { storeId } = await params;
    const { baseUrl, apiKey } = await req.json();
    if (!baseUrl || !apiKey) {
      return NextResponse.json({ error: "MISSING_FIELDS" }, { status: 400 });
    }

    const store = await Store.findByIdAndUpdate(storeId, { vendorApi: { baseUrl, apiKey } }, { new: true });
    if (!store) return NextResponse.json({ error: "STORE_NOT_FOUND" }, { status: 404 });

    await AuditLog.create({
      storeId,
      actorType: "HQ_ADMIN",
      actorId: session.sub,
      action: "VENDOR_API_CONFIG_SET",
      meta: { baseUrl },
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    return handleApiError(e);
  }
}
