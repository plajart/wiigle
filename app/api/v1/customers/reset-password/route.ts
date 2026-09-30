import { NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import User from "@/lib/models/User";
import PointAccount from "@/lib/models/PointAccount";
import PointEvent from "@/lib/models/PointEvent";
import AuditLog from "@/lib/models/AuditLog";
import { requireStoreManager, ApiError } from "@/lib/rbac";
import { normalizePhone } from "@/lib/password";
import { newInitialCredentials } from "@/lib/initial-password";
import { hasCompanyRelation } from "@/lib/points";
import { handleApiError, rateLimit } from "@/lib/api-utils";

// 상위 계정(본사/고객사 운영자/매장 관리자)이 고객의 비밀번호 분실에 대응하는 임시 방안(문자·앱알림 구현 전까지).
// 그 고객에게 새 임의 초기 비밀번호를 부여하고 "처음 로그인" 상태로 되돌린다. 새 비밀번호는 이 응답·화면·로그 어디에도
// 싣지 않는다 — 고객이 로그인 화면의 "초기 비밀번호 확인"에서 직접 본다.
// 범위: 본사=모든 고객, 고객사 운영자=자기 고객사와 거래한 고객, 매장 관리자=자기 매장과 거래한 고객. 일반 고객(role=user)만 대상.
export async function POST(req: Request) {
  try {
    const session = await requireStoreManager();
    rateLimit(`reset-pw:${session.sub}`, 60, 10 * 60 * 1000);
    await dbConnect();

    const body = await req.json().catch(() => ({}));
    const phone = normalizePhone(String(body?.phone ?? ""));
    if (phone.length < 9) return NextResponse.json({ error: "PHONE_REQUIRED" }, { status: 400 });

    const user = await User.findOne({ phone: { $in: [phone, String(body?.phone ?? "")] } }).select("role name phone").lean();
    // 범위 밖·없는 번호·운영 계정 모두 같은 응답 — 다른 매장/고객사 고객의 존재 여부를 알려주지 않는다.
    const notFound = NextResponse.json({ error: "CUSTOMER_NOT_FOUND" }, { status: 404 });
    if (!user || user.role !== "user") return notFound;

    const userId = String(user._id);
    let inScope = false;
    if (session.role === "owner") inScope = true;
    else if (session.role === "admin") inScope = !!session.companyAdminOf && (await hasCompanyRelation(userId, session.companyAdminOf));
    else if (session.role === "manager") {
      if (!session.storeManagerOf) throw new ApiError(403, "NO_STORE_CONTEXT");
      inScope = !!(await PointAccount.exists({ userId, storeId: session.storeManagerOf })) || !!(await PointEvent.exists({ userId, storeId: session.storeManagerOf }));
    }
    if (!inScope) return notFound;

    const creds = await newInitialCredentials();
    await User.updateOne({ _id: user._id }, { $set: { passwordHash: creds.hash, initialPassword: creds.plain, firstLogin: true } });

    await AuditLog.create({
      storeId: session.role === "manager" ? session.storeManagerOf : null,
      actorType: session.role === "manager" ? "STORE_ADMIN" : "HQ_ADMIN",
      actorId: session.sub,
      action: "CUSTOMER_PASSWORD_RESET",
      meta: { targetUserId: userId, targetPhone: user.phone },
    });

    return NextResponse.json({ ok: true, name: user.name, phone: user.phone });
  } catch (e) {
    return handleApiError(e);
  }
}
