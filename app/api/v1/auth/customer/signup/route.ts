import { NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import User from "@/lib/models/User";
import Store from "@/lib/models/Store";
import { hashPassword, signSession, SESSION_COOKIE } from "@/lib/auth";
import { issueDigitalCardNo } from "@/lib/card";
import { checkNewPassword, normalizePhone } from "@/lib/password";
import { handleApiError, clientIp, rateLimit } from "@/lib/api-utils";

// 고객 자가가입 — 입력한 휴대폰번호와 비밀번호로 **바로 가입**하고 로그인한다(문자 인증 없음).
//
// 전화번호 소유를 확인하지 않으므로(phoneVerified=false), 신원 근거는 "매장에서 그 번호로 결제·적립이 확인되는 것"이다:
// 계산원이 전화번호로 고객을 확인하고, 결제 때 카드 식별번호가 함께 기록된다. 이미 매장(POS)에서 만들어진 번호는
// 여기서 가입할 수 없고(PHONE_ALREADY_USED) 로그인 화면의 "처음 로그인하시나요? 초기 비밀번호 확인"을 쓴다.
// ⚠ 알려진 한계: 아직 어디에도 등록되지 않은 번호는 누구든 먼저 가입할 수 있다. 남용을 줄이려고 IP당 가입 횟수를 제한한다.
export async function POST(req: Request) {
  try {
    rateLimit(`signup:${clientIp(req)}`, 60, 10 * 60 * 1000); // 매장 QR로 여러 고객이 같은 와이파이(같은 IP)에서 가입할 수 있다

    await dbConnect();
    const { phone: rawPhone, name, password, storeRef } = await req.json();
    const phone = normalizePhone(rawPhone);
    const cleanName = typeof name === "string" ? name.trim().slice(0, 50) : "";
    if (phone.length < 9 || !cleanName || !password) {
      return NextResponse.json({ error: "MISSING_FIELDS" }, { status: 400 });
    }
    const pwError = checkNewPassword(password);
    if (pwError) return NextResponse.json({ error: pwError }, { status: 400 });

    const dup = await User.findOne({ phone: { $in: [phone, String(rawPhone)] } }).select("_id").lean();
    if (dup) return NextResponse.json({ error: "PHONE_ALREADY_USED" }, { status: 409 });

    // 매장 고정 QR 스티커로 유입된 가입이면 참고용으로만 기록(있어도 없어도 가입엔 지장 없음)
    let referredByStore = undefined;
    if (storeRef && /^[a-f\d]{24}$/i.test(String(storeRef)) && (await Store.exists({ _id: storeRef }))) {
      referredByStore = storeRef;
    }

    let user;
    try {
      user = await User.create({
        phone,
        name: cleanName,
        passwordHash: await hashPassword(password),
        phoneVerified: false,
        digitalCardNo: await issueDigitalCardNo(),
        referredByStore,
      });
    } catch (e) {
      // 같은 번호로 동시에 두 번 가입 — phone 유니크 인덱스 충돌
      if ((e as { code?: number }).code === 11000) return NextResponse.json({ error: "PHONE_ALREADY_USED" }, { status: 409 });
      throw e;
    }

    const token = await signSession({ sub: String(user._id), role: user.role, name: user.name });
    const res = NextResponse.json({ ok: true });
    res.cookies.set(SESSION_COOKIE, token, { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 7 });
    return res;
  } catch (e) {
    return handleApiError(e);
  }
}
