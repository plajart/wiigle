import { NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import User from "@/lib/models/User";
import { verifyPassword, signSession, SESSION_COOKIE } from "@/lib/auth";
import { normalizePhone } from "@/lib/password";
import { handleApiError, clientIp, rateLimit } from "@/lib/api-utils";

// 비밀번호 무차별 대입 방어(2026-09-29 보안점검) — IP당, 그리고 특정 전화번호를 노린
// 공격까지 같이 막기 위해 전화번호당으로도 제한한다.
//
// 매장에서 포인트가 적립되며 만들어진 손님 계정은 비밀번호가 비어 있다(passwordHash=""). 그런
// 계정은 전화번호만 넣고 비밀번호를 비워 두면 로그인되고, 곧바로 비밀번호를 정하게 안내한다.
// 권한 계정(소유자 등)도 운영자가 일부러 비밀번호를 비워 둔 경우에는 같은 방식으로 들어오지만, 그 세션은
// 비밀번호를 정하기 전까지 권한 화면·API를 쓸 수 없다(requireSession의 PASSWORD_SETUP_REQUIRED).
export async function POST(req: Request) {
  try {
    await dbConnect();
    const { phone, password } = await req.json();
    if (!phone) return NextResponse.json({ error: "MISSING_FIELDS" }, { status: 400 });
    const pw = typeof password === "string" ? password : "";

    rateLimit(`login-ip:${clientIp(req)}`, 20, 10 * 60 * 1000);
    rateLimit(`login-phone:${phone}`, 10, 10 * 60 * 1000);

    // 하이픈 등을 넣어 입력해도 찾을 수 있게(가입 때 입력한 그대로 저장된 번호도 함께 조회)
    const user = await User.findOne({ phone: { $in: [String(phone), normalizePhone(phone)] } });
    let ok = false;
    let pwUnset = false;
    if (user) {
      if (!user.passwordHash) {
        ok = pw === "";
        pwUnset = ok;
      } else {
        ok = pw !== "" && (await verifyPassword(pw, user.passwordHash));
      }
    }
    if (!user || !ok) {
      return NextResponse.json({ error: "INVALID_CREDENTIALS" }, { status: 401 });
    }

    const token = await signSession({
      sub: String(user._id),
      role: user.role,
      companyAdminOf: user.companyAdminOf ? String(user.companyAdminOf) : undefined,
      storeManagerOf: user.storeManagerOf ? String(user.storeManagerOf) : undefined,
      name: user.name,
      pwUnset: pwUnset || undefined,
    });
    const res = NextResponse.json({
      ok: true,
      role: user.role,
      companyAdminOf: user.companyAdminOf ?? null,
      storeManagerOf: user.storeManagerOf ?? null,
      passwordUnset: pwUnset,
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
