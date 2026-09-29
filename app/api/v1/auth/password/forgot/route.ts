import { NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import User from "@/lib/models/User";
import PasswordReset from "@/lib/models/PasswordReset";
import { generateOtp } from "@/lib/otp";
import { sendSms } from "@/lib/sms";
import { hashResetCode, normalizePhone } from "@/lib/password";
import { handleApiError, clientIp, rateLimit } from "@/lib/api-utils";

const RESEND_COOLDOWN_MS = 60 * 1000;

// 비밀번호 찾기 1단계 — 가입된 번호면 문자로 인증번호를 보낸다. 번호가 가입돼 있는지 여부를
// 밖에서 알아낼 수 없도록, 가입 여부와 상관없이 항상 같은 응답을 준다.
export async function POST(req: Request) {
  try {
    const { phone: rawPhone } = await req.json();
    const phone = normalizePhone(rawPhone);
    if (phone.length < 9) return NextResponse.json({ error: "PHONE_REQUIRED" }, { status: 400 });

    rateLimit(`pw-forgot-ip:${clientIp(req)}`, 10, 10 * 60 * 1000);
    rateLimit(`pw-forgot-phone:${phone}`, 5, 60 * 60 * 1000);

    await dbConnect();
    const user = await User.findOne({ phone }).select("_id").lean();
    if (user) {
      const existing = await PasswordReset.findOne({ phone }).lean();
      // 방금 보냈다면 다시 보내지 않는다(문자 요금·도배 방지) — 응답은 똑같이 ok.
      if (!existing || Date.now() - new Date(existing.createdAt).getTime() > RESEND_COOLDOWN_MS) {
        const code = generateOtp();
        await PasswordReset.findOneAndUpdate(
          { phone },
          { phone, codeHash: hashResetCode(phone, code), attempts: 0, expiresAt: new Date(Date.now() + 5 * 60 * 1000), createdAt: new Date() },
          { upsert: true, setDefaultsOnInsert: true }
        );
        await sendSms(phone, `[포인트 관리] 비밀번호 찾기 인증번호는 ${code} 입니다. 5분 안에 입력해주세요.`);
      }
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return handleApiError(e);
  }
}
