import { NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import { requireSession } from "@/lib/rbac";
import User from "@/lib/models/User";
import { hashPassword, verifyPassword, signSession, SESSION_COOKIE } from "@/lib/auth";
import { verifySession } from "@/lib/auth";
import { checkNewPassword } from "@/lib/password";
import { handleApiError, rateLimit } from "@/lib/api-utils";
import { cookies } from "next/headers";

const FIRST_LOGIN_WINDOW_SEC = 60 * 60; // 초기 비밀번호로 방금 로그인한 세션이 현재 비밀번호 없이 바꿀 수 있는 시간

// 로그인한 회원이 비밀번호를 바꾼다 — 현재 비밀번호를 한 번 더 확인한다.
// 단, 초기·임시 비밀번호로 **방금(1시간 이내) 첫 로그인한 세션**은 그 비밀번호를 이미 입력했으므로 현재 비밀번호 확인을
// 생략한다(안내 화면에서 바로 변경). 바꾸고 나면 그 표시가 빠진 새 세션으로 교체한다.
export async function POST(req: Request) {
  try {
    await dbConnect();
    const session = await requireSession();
    rateLimit(`pw-change:${session.sub}`, 10, 10 * 60 * 1000);

    const { currentPassword, newPassword } = await req.json();
    if (!newPassword) return NextResponse.json({ error: "MISSING_FIELDS" }, { status: 400 });
    const pwError = checkNewPassword(newPassword);
    if (pwError) return NextResponse.json({ error: pwError }, { status: 400 });

    const user = await User.findById(session.sub);
    if (!user) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });

    // 세션 토큰의 발급 시각으로 "방금 로그인"인지 확인(fl 표시는 로그인 때만 붙는다)
    let recentFirstLogin = false;
    if (session.fl) {
      const token = (await cookies()).get(SESSION_COOKIE)?.value;
      const payload = token ? await verifySession(token) : null;
      const iat = (payload as unknown as { iat?: number } | null)?.iat;
      recentFirstLogin = typeof iat === "number" && Date.now() / 1000 - iat < FIRST_LOGIN_WINDOW_SEC;
    }

    if (!recentFirstLogin) {
      if (!currentPassword) return NextResponse.json({ error: "MISSING_FIELDS" }, { status: 400 });
      if (currentPassword === newPassword) return NextResponse.json({ error: "SAME_PASSWORD" }, { status: 400 });
      if (!(await verifyPassword(String(currentPassword), user.passwordHash))) {
        return NextResponse.json({ error: "WRONG_CURRENT_PASSWORD" }, { status: 403 });
      }
    }

    user.passwordHash = await hashPassword(newPassword);
    user.initialPassword = undefined;
    user.firstLogin = false;
    await user.save();

    const res = NextResponse.json({ ok: true });
    if (session.fl) {
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
