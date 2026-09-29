import { NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import User from "@/lib/models/User";
import { verifyPassword, signSession, SESSION_COOKIE } from "@/lib/auth";
import { normalizePhone } from "@/lib/password";
import { handleApiError, clientIp, rateLimit } from "@/lib/api-utils";

// 비밀번호 무차별 대입 방어(2026-09-29 보안점검) — IP당, 그리고 특정 전화번호를 노린
// 공격까지 같이 막기 위해 전화번호당으로도 제한한다.
//
// 임시·초기 비밀번호(매장 POS에서 자동 생성된 손님, 지정 시 새로 만든 계정)로 처음 로그인에 성공하면 그 초기 비밀번호
// 원문을 DB에서 지운다 — 그 뒤로는 로그인 화면이 어떤 비밀번호도 안내하지 않는다. 응답의 firstLogin은 "비밀번호를
// 변경하라"는 안내를 이번 한 번만 보여주기 위한 신호다.
export async function POST(req: Request) {
  try {
    await dbConnect();
    const { phone, password } = await req.json();
    if (!phone || !password) return NextResponse.json({ error: "MISSING_FIELDS" }, { status: 400 });

    rateLimit(`login-ip:${clientIp(req)}`, 20, 10 * 60 * 1000);
    rateLimit(`login-phone:${phone}`, 10, 10 * 60 * 1000);

    // 하이픈 등을 넣어 입력해도 찾을 수 있게(가입 때 입력한 그대로 저장된 번호도 함께 조회)
    const user = await User.findOne({ phone: { $in: [String(phone), normalizePhone(phone)] } });
    if (!user || !user.passwordHash || !(await verifyPassword(String(password), user.passwordHash))) {
      return NextResponse.json({ error: "INVALID_CREDENTIALS" }, { status: 401 });
    }

    const firstLogin = user.firstLogin === true || !!user.initialPassword;
    if (firstLogin) {
      user.initialPassword = undefined;
      user.firstLogin = false;
      await user.save();
    }

    const token = await signSession({
      sub: String(user._id),
      role: user.role,
      companyAdminOf: user.companyAdminOf ? String(user.companyAdminOf) : undefined,
      storeManagerOf: user.storeManagerOf ? String(user.storeManagerOf) : undefined,
      name: user.name,
      fl: firstLogin || undefined,
    });
    const res = NextResponse.json({
      ok: true,
      role: user.role,
      companyAdminOf: user.companyAdminOf ?? null,
      storeManagerOf: user.storeManagerOf ?? null,
      firstLogin,
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
