import { NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import User from "@/lib/models/User";
import PasswordReset from "@/lib/models/PasswordReset";
import { hashPassword } from "@/lib/auth";
import { checkNewPassword, hashResetCode, normalizePhone, safeEqualHex } from "@/lib/password";
import { handleApiError, clientIp, rateLimit } from "@/lib/api-utils";

const MAX_ATTEMPTS = 5;

// 비밀번호 찾기 2단계 — 문자로 받은 인증번호가 맞으면 새 비밀번호로 바꾼다.
// 자동 로그인은 하지 않는다(바꾼 뒤 로그인 화면에서 새 비밀번호로 들어오게).
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const phone = normalizePhone(body.phone);
    const code = typeof body.code === "string" ? body.code.trim() : "";
    const newPassword = body.newPassword;
    if (phone.length < 9 || !code || !newPassword) {
      return NextResponse.json({ error: "MISSING_FIELDS" }, { status: 400 });
    }
    const pwError = checkNewPassword(newPassword);
    if (pwError) return NextResponse.json({ error: pwError }, { status: 400 });

    rateLimit(`pw-reset-ip:${clientIp(req)}`, 20, 10 * 60 * 1000);
    rateLimit(`pw-reset-phone:${phone}`, 10, 10 * 60 * 1000);

    await dbConnect();
    const reset = await PasswordReset.findOne({ phone });
    if (!reset || reset.expiresAt.getTime() < Date.now()) {
      return NextResponse.json({ error: "INVALID_OR_EXPIRED_CODE" }, { status: 400 });
    }
    // 틀린 횟수를 먼저 올린다(동시에 여러 번 찍어보는 시도도 같이 세기 위해).
    const updated = await PasswordReset.findOneAndUpdate({ _id: reset._id }, { $inc: { attempts: 1 } }, { new: true });
    if (!updated || updated.attempts > MAX_ATTEMPTS) {
      await PasswordReset.deleteOne({ _id: reset._id });
      return NextResponse.json({ error: "INVALID_OR_EXPIRED_CODE" }, { status: 400 });
    }
    if (!safeEqualHex(updated.codeHash, hashResetCode(phone, code))) {
      return NextResponse.json({ error: "INVALID_OR_EXPIRED_CODE" }, { status: 400 });
    }

    // 인증번호는 한 번만 쓸 수 있다 — 삭제에 성공한 요청만 비밀번호를 바꾼다.
    const consumed = await PasswordReset.findOneAndDelete({ _id: reset._id });
    if (!consumed) return NextResponse.json({ error: "INVALID_OR_EXPIRED_CODE" }, { status: 400 });

    const passwordHash = await hashPassword(newPassword);
    // 문자를 받은 본인임이 확인됐으므로 전화번호 인증도 완료로 표시한다.
    const user = await User.findOneAndUpdate({ phone }, { passwordHash, phoneVerified: true, firstLogin: false, $unset: { initialPassword: "" } });
    if (!user) return NextResponse.json({ error: "INVALID_OR_EXPIRED_CODE" }, { status: 400 });

    return NextResponse.json({ ok: true });
  } catch (e) {
    return handleApiError(e);
  }
}
