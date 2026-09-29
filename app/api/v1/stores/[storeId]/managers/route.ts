import { NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import { requireCompanyAdmin, assertStoreScope } from "@/lib/rbac";
import User from "@/lib/models/User";
import AuditLog from "@/lib/models/AuditLog";
import { assignManager, unassignManager } from "@/lib/account-assign";
import { handleApiError } from "@/lib/api-utils";

// 본사 운영자(자기 고객사 매장) / 소유자: 매장 관리자 목록 · 지정 · 해제.

export async function GET(_req: Request, { params }: { params: Promise<{ storeId: string }> }) {
  try {
    await dbConnect();
    const session = await requireCompanyAdmin();
    const { storeId } = await params;
    await assertStoreScope(session, storeId);
    const managers = await User.find({ role: "manager", storeManagerOf: storeId }).select("name phone").sort({ name: 1 }).lean();
    return NextResponse.json({ managers: managers.map((u) => ({ _id: String(u._id), name: u.name, phone: u.phone })) });
  } catch (e) {
    return handleApiError(e);
  }
}

// { phone, name? } — 가입한 회원이면 승격, 아니면 name을 받아 계정을 새로 만든다(임시 비밀번호는 응답으로 한 번만).
export async function POST(req: Request, { params }: { params: Promise<{ storeId: string }> }) {
  try {
    await dbConnect();
    const session = await requireCompanyAdmin();
    const { storeId } = await params;
    await assertStoreScope(session, storeId);
    const { phone, name } = await req.json();
    if (!phone) return NextResponse.json({ error: "PHONE_REQUIRED" }, { status: 400 });

    const result = await assignManager(storeId, phone, name);
    await AuditLog.create({
      storeId,
      actorType: "HQ_ADMIN",
      actorId: session.sub,
      action: "MANAGER_ASSIGN",
      meta: { userId: result.userId, created: result.created },
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return handleApiError(e);
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ storeId: string }> }) {
  try {
    await dbConnect();
    const session = await requireCompanyAdmin();
    const { storeId } = await params;
    await assertStoreScope(session, storeId);
    const userId = new URL(req.url).searchParams.get("userId");
    if (!userId) return NextResponse.json({ error: "USER_ID_REQUIRED" }, { status: 400 });

    await unassignManager(storeId, userId);
    await AuditLog.create({
      storeId,
      actorType: "HQ_ADMIN",
      actorId: session.sub,
      action: "MANAGER_UNASSIGN",
      meta: { userId },
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return handleApiError(e);
  }
}
