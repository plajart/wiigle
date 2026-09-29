import { NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import { requireSession, assertStoreScope } from "@/lib/rbac";
import Store, { PosScope } from "@/lib/models/Store";
import AuditLog from "@/lib/models/AuditLog";
import { handleApiError } from "@/lib/api-utils";

const VALID_SCOPES: PosScope[] = ["read_balance", "read_history", "write_redeem", "write_earn", "accept_transfer"];

export async function GET(_req: Request, { params }: { params: Promise<{ storeId: string }> }) {
  try {
    await dbConnect();
    const { storeId } = await params;
    const session = await requireSession();
    await assertStoreScope(session, storeId);
    const store = await Store.findById(storeId).select("posIntegration").lean();
    if (!store) return NextResponse.json({ error: "STORE_NOT_FOUND" }, { status: 404 });
    return NextResponse.json({ posIntegration: store.posIntegration });
  } catch (e) {
    return handleApiError(e);
  }
}

// 매장 관리자: POS 연동 동의 스코프 설정/철회 (원칙 1 — 매장 동의 없이는 어떤 스코프도 켜지지 않음)
export async function PUT(req: Request, { params }: { params: Promise<{ storeId: string }> }) {
  try {
    await dbConnect();
    const { storeId } = await params;
    const session = await requireSession();
    await assertStoreScope(session, storeId);

    const { scopes } = await req.json();
    if (!Array.isArray(scopes) || scopes.some((s) => !VALID_SCOPES.includes(s))) {
      return NextResponse.json({ error: "INVALID_SCOPES" }, { status: 400 });
    }

    const store = await Store.findByIdAndUpdate(
      storeId,
      { posIntegration: { scopes, grantedBy: session.sub, grantedAt: new Date() } },
      { new: true }
    );
    if (!store) return NextResponse.json({ error: "STORE_NOT_FOUND" }, { status: 404 });

    await AuditLog.create({
      storeId,
      actorType: session.role === "owner" || session.role === "admin" ? "HQ_ADMIN" : "STORE_ADMIN",
      actorId: session.sub,
      action: "POS_SCOPE_UPDATE",
      meta: { scopes },
    });

    return NextResponse.json({ ok: true, posIntegration: store.posIntegration });
  } catch (e) {
    return handleApiError(e);
  }
}
