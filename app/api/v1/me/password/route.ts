import { NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import { requireSessionAllowUnsetPassword } from "@/lib/rbac";
import User from "@/lib/models/User";
import { hashPassword, verifyPassword, signSession, SESSION_COOKIE } from "@/lib/auth";
import { checkNewPassword } from "@/lib/password";
import { handleApiError, rateLimit } from "@/lib/api-utils";

// 로그인한 회원이 비밀번호를 바꾼다. 이미 비밀번호가 있으면 현재 비밀번호를 한 번 더 확인하고,
// 아직 정하지 않은 계정(매장에서 만들어져 비워둔 채 로그인한 손님)은 확인 없이 처음 정한다.
// 처음 정한 뒤에는 "비밀번호 미설정" 표시가 빠진 새 세션으로 바꿔 준다.
export async function POST(req: Request) {
  try {
    await dbConnect();
    const session = await requireSessionAllowUnsetPassword();
    rateLimit(`pw-change:${session.sub}`, 10, 10 * 60 * 1000);

    const { currentPassword, newPassword } = await req.json();
    if (!newPassword) return NextResponse.json({ error: "MISSING_FIELDS" }, { status: 400 });
    const pwError = checkNewPassword(newPassword);
    if (pwError) return NextResponse.json({ error: pwError }, { status: 400 });

    const user = await User.findById(session.sub);
    if (!user) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });

    const firstTime = !user.passwordHash;
    if (!firstTime) {
      if (!currentPassword) return NextResponse.json({ error: "MISSING_FIELDS" }, { status: 400 });
      if (currentPassword === newPassword) return NextResponse.json({ error: "SAME_PASSWORD" }, { status: 400 });
      if (!(await verifyPassword(String(currentPassword), user.passwordHash))) {
        return NextResponse.json({ error: "WRONG_CURRENT_PASSWORD" }, { status: 403 });
      }
    }

    user.passwordHash = await hashPassword(newPassword);
    await user.save();

    const res = NextResponse.json({ ok: true, firstTime });
    if (session.pwUnset) {
      const token = await signSession({
        sub: String(user._id),
        role: user.role,
        companyAdminOf: user.companyAdminOf ? String(user.companyAdminOf) : undefined,
        storeManagerOf: user.storeManagerOf ? String(user.storeManagerOf) : undefined,
        name: user.name,
      });
      res.cookies.set(SESSION_COOKIE, token, { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 7 });
    }
    return res;
  } catch (e) {
    return handleApiError(e);
  }
}
