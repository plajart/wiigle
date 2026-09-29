import { NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import { requireOwner } from "@/lib/rbac";
import User from "@/lib/models/User";
import AuditLog from "@/lib/models/AuditLog";
import { assignCompanyAdmin } from "@/lib/account-assign";
import { normalizePhone } from "@/lib/password";
import { handleApiError } from "@/lib/api-utils";

// 소유자: 현재 운영자(admin) 계정 목록과 배정된 고객사.
export async function GET() {
  try {
    await dbConnect();
    await requireOwner();
    const admins = await User.find({ role: "admin" }).select("name phone companyAdminOf").sort({ name: 1 }).lean();
    return NextResponse.json({
      admins: admins.map((u) => ({
        _id: String(u._id),
        name: u.name,
        phone: u.phone,
        companyId: u.companyAdminOf ? String(u.companyAdminOf) : null,
      })),
    });
  } catch (e) {
    return handleApiError(e);
  }
}

// 소유자: 회원(전화번호)을 특정 고객사의 본사 운영자로 지정하거나(companyId 지정), 운영자 등급을
// 해제(companyId=null → 일반 회원으로 되돌림). 가입하지 않은 번호면 name을 함께 보내 계정을 새로 만든다
// (임시 비밀번호는 응답으로 한 번만). 소유자·매장 관리자 계정은 여기서 바꾸지 않는다.
export async function POST(req: Request) {
  try {
    await dbConnect();
    const session = await requireOwner();
    const { phone, companyId, name } = await req.json();
    if (!phone) return NextResponse.json({ error: "PHONE_REQUIRED" }, { status: 400 });

    if (companyId) {
      const result = await assignCompanyAdmin(companyId, phone, name);
      await AuditLog.create({
        storeId: null,
        actorType: "HQ_ADMIN",
        actorId: session.sub,
        action: "ADMIN_ASSIGN",
        meta: { userId: result.userId, companyId, created: result.created },
      });
      return NextResponse.json({ ok: true, ...result });
    }

    const user = await User.findOne({ phone: normalizePhone(phone) });
    if (!user) return NextResponse.json({ error: "USER_NOT_FOUND" }, { status: 404 });
    if (user.role !== "admin") return NextResponse.json({ error: "CANNOT_CHANGE_THIS_ROLE" }, { status: 409 });
    user.role = "user";
    user.companyAdminOf = undefined;
    await user.save();
    await AuditLog.create({
      storeId: null,
      actorType: "HQ_ADMIN",
      actorId: session.sub,
      action: "ADMIN_UNASSIGN",
      meta: { userId: user._id },
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return handleApiError(e);
  }
}
