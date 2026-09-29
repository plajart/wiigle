import { NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import User from "@/lib/models/User";
import Store from "@/lib/models/Store";
import PendingCustomerSignup from "@/lib/models/PendingCustomerSignup";
import { hashPassword } from "@/lib/auth";
import { generateOtp } from "@/lib/otp";
import { sendSms } from "@/lib/sms";
import { checkNewPassword } from "@/lib/password";
import { handleApiError, clientIp, rateLimit } from "@/lib/api-utils";

// 가입 요청 — 진짜 User는 아직 안 만든다(전화번호 소유를 OTP로 증명하기 전까지는
// PendingCustomerSignup에만 둔다, 2026-09-29 보안점검: 예전엔 가입 즉시 User(phone
// unique)를 만들어버려서, OTP가 뭐든 상관없이 그 순간 그 번호를 선점해버리는 문제가
// 있었음 — POS의 getOrCreateUserByPhone은 phoneVerified를 안 보고 존재만 보기 때문에
// 실제 손님이 나중에 그 번호로 적립하면 선점한 계정이 가로채게 됨). 같은 번호로 다시
// 요청하면 재발급(덮어쓰기)으로 처리 — 정상적인 재전송 요청도 있을 수 있어서.
export async function POST(req: Request) {
  try {
    rateLimit(`signup:${clientIp(req)}`, 5, 10 * 60 * 1000);

    await dbConnect();
    const { phone, name, password, storeRef } = await req.json();
    if (!phone || !name || !password) {
      return NextResponse.json({ error: "MISSING_FIELDS" }, { status: 400 });
    }
    const pwError = checkNewPassword(password);
    if (pwError) return NextResponse.json({ error: pwError }, { status: 400 });
    const dup = await User.findOne({ phone });
    if (dup) return NextResponse.json({ error: "PHONE_ALREADY_USED" }, { status: 409 });

    // 매장 고정 QR 스티커로 유입된 가입이면 참고용으로만 기록(있어도 없어도 가입엔 지장 없음)
    let referredByStore = undefined;
    if (storeRef) {
      const exists = await Store.exists({ _id: storeRef });
      if (exists) referredByStore = storeRef;
    }

    const passwordHash = await hashPassword(password);
    const code = generateOtp();
    const otpExpiresAt = new Date(Date.now() + 5 * 60 * 1000);

    await PendingCustomerSignup.findOneAndUpdate(
      { phone },
      { phone, name, passwordHash, storeRef: referredByStore, otpCode: code, otpExpiresAt },
      { upsert: true, setDefaultsOnInsert: true }
    );

    // 문자로 발송한다(SMS_WEBHOOK_URL 미설정이면 발송되지 않음 — lib/sms.ts). 응답에는 절대 코드를
    // 내려주지 않는다(2026-09-29 보안점검).
    await sendSms(phone, `[포인트 관리] 가입 인증번호는 ${code} 입니다. 5분 안에 입력해주세요.`);
    return NextResponse.json({ ok: true, phone });
  } catch (e) {
    return handleApiError(e);
  }
}
