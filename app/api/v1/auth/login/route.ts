import { NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import User from "@/lib/models/User";
import { verifyPassword, signSession, SESSION_COOKIE } from "@/lib/auth";
import { handleApiError, clientIp, rateLimit } from "@/lib/api-utils";

// 비밀번호 무차별 대입 방어(2026-09-29 보안점검) — IP당, 그리고 특정 전화번호를 노린
// 공격까지 같이 막기 위해 전화번호당으로도 제한한다.
export async function POST(req: Request) {
  try {
    await dbConnect();
    const { phone, password } = await req.json();
    if (!phone || !password) return NextResponse.json({ error: "MISSING_FIELDS" }, { status: 400 });

    rateLimit(`login-ip:${clientIp(req)}`, 20, 10 * 60 * 1000);
    rateLimit(`login-phone:${phone}`, 10, 10 * 60 * 1000);

    const user = await User.findOne({ phone });
    if (!user || !(await verifyPassword(password, user.passwordHash))) {
      return NextResponse.json({ error: "INVALID_CREDENTIALS" }, { status: 401 });
    }

    const token = await signSession({
      sub: String(user._id),
      role: user.role,
      companyAdminOf: user.companyAdminOf ? String(user.companyAdminOf) : undefined,
      storeManagerOf: user.storeManagerOf ? String(user.storeManagerOf) : undefined,
      name: user.name,
    });
    const res = NextResponse.json({
      ok: true,
      role: user.role,
      companyAdminOf: user.companyAdminOf ?? null,
      storeManagerOf: user.storeManagerOf ?? null,
    });
    res.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 7,
    });
    return res;
  } catch (e) {
    return handleApiError(e);
  }
}
