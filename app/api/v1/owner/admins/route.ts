import { NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import { requireOwner } from "@/lib/rbac";
import Company from "@/lib/models/Company";
import User from "@/lib/models/User";
import AuditLog from "@/lib/models/AuditLog";
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

// 소유자: 기존 회원(전화번호)을 특정 고객사의 운영자로 배정하거나(companyId 지정), 운영자 등급을
// 해제(companyId=null → 일반 회원으로 되돌림). 소유자·매장 관리자 계정은 여기서 바꾸지 않는다
// (한 계정은 한 등급만 가지므로, 매장 관리자를 운영자로 바꾸면 매장 권한이 사라져서다).
export async function POST(req: Request) {
  try {
    await dbConnect();
    const session = await requireOwner();
    const { phone, companyId } = await req.json();
    if (!phone) return NextResponse.json({ error: "PHONE_REQUIRED" }, { status: 400 });

    const user = await User.findOne({ phone: String(phone).replace(/[^0-9]/g, "") });
    if (!user) return NextResponse.json({ error: "USER_NOT_FOUND" }, { status: 404 });
    if (user.role === "owner" || user.role === "manager") {
      return NextResponse.json({ error: "CANNOT_CHANGE_THIS_ROLE" }, { status: 409 });
    }

    if (companyId) {
      const company = await Company.findById(companyId).select("_id").lean();
      if (!company) return NextResponse.json({ error: "COMPANY_NOT_FOUND" }, { status: 404 });
      user.role = "admin";
      user.companyAdminOf = company._id;
    } else {
      user.role = "user";
      user.companyAdminOf = undefined;
    }
    await user.save();

    await AuditLog.create({
      storeId: null,
      actorType: "HQ_ADMIN",
      actorId: session.sub,
      action: companyId ? "ADMIN_ASSIGN" : "ADMIN_UNASSIGN",
      meta: { userId: user._id, companyId: companyId ?? null },
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return handleApiError(e);
  }
}
