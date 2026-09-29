import { NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import User from "@/lib/models/User";
import PendingCustomerSignup from "@/lib/models/PendingCustomerSignup";
import { issueDigitalCardNo } from "@/lib/card";
import { signSession, SESSION_COOKIE } from "@/lib/auth";
import { handleApiError, clientIp, rateLimit } from "@/lib/api-utils";

// OTP 검증 성공 시점에만 진짜 User를 만든다(2026-09-29 보안점검 — PendingCustomerSignup 참고).
export async function POST(req: Request) {
  try {
    rateLimit(`otp-verify:${clientIp(req)}`, 10, 10 * 60 * 1000);

    await dbConnect();
    const { phone, code } = await req.json();
    if (!phone || !code) return NextResponse.json({ error: "MISSING_FIELDS" }, { status: 400 });

    const pending = await PendingCustomerSignup.findOne({ phone });
    if (!pending || pending.otpExpiresAt.getTime() < Date.now() || pending.otpCode !== String(code)) {
      return NextResponse.json({ error: "INVALID_OR_EXPIRED_OTP" }, { status: 400 });
    }

    // 대기 중이던 사이 다른 경로(POS 등)로 같은 번호의 계정이 이미 생겼을 수 있어 재확인.
    const dup = await User.findOne({ phone });
    if (dup) {
      await PendingCustomerSignup.deleteOne({ _id: pending._id });
      return NextResponse.json({ error: "PHONE_ALREADY_USED" }, { status: 409 });
    }

    const digitalCardNo = await issueDigitalCardNo();
    const user = await User.create({
      phone: pending.phone,
      name: pending.name,
      passwordHash: pending.passwordHash,
      phoneVerified: true,
      digitalCardNo,
      referredByStore: pending.storeRef,
    });
    await PendingCustomerSignup.deleteOne({ _id: pending._id });

    const token = await signSession({
      sub: String(user._id),
      role: user.role,
      companyAdminOf: user.companyAdminOf ? String(user.companyAdminOf) : undefined,
      storeManagerOf: user.storeManagerOf ? String(user.storeManagerOf) : undefined,
      name: user.name,
    });
    const res = NextResponse.json({ ok: true });
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
