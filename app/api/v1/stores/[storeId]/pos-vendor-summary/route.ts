import { NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import { requireSession, assertStoreScope } from "@/lib/rbac";
import Store from "@/lib/models/Store";
import AuditLog from "@/lib/models/AuditLog";
import { fetchVendorSummary } from "@/lib/pos/vendor-http-adapter";
import { handleApiError } from "@/lib/api-utils";

// 실제 벤더 POS(카운터 단말)에서 회원/포인트 현황을 조회 — read_balance 스코프 동의 필요
export async function GET(_req: Request, { params }: { params: Promise<{ storeId: string }> }) {
  try {
    await dbConnect();
    const { storeId } = await params;
    const session = await requireSession();
    await assertStoreScope(session, storeId);

    const store = await Store.findById(storeId);
    if (!store) return NextResponse.json({ error: "STORE_NOT_FOUND" }, { status: 404 });
    if (!store.vendorApi?.baseUrl) {
      return NextResponse.json({ error: "VENDOR_NOT_CONFIGURED" }, { status: 404 });
    }
    if (!store.posIntegration.scopes.includes("read_balance")) {
      return NextResponse.json({ error: "READ_BALANCE_NOT_CONSENTED" }, { status: 403 });
    }

    const summary = await fetchVendorSummary(store.vendorApi.baseUrl, store.vendorApi.apiKey);

    await AuditLog.create({
      storeId,
      actorType: session.isHqAdmin ? "HQ_ADMIN" : "STORE_ADMIN",
      actorId: session.sub,
      action: "VENDOR_SUMMARY_FETCH",
      scope: "read_balance",
    });

    return NextResponse.json(summary);
  } catch (e) {
    return handleApiError(e);
  }
}
