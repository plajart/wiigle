import { NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import User from "@/lib/models/User";
import PasswordReset from "@/lib/models/PasswordReset";
import { generateOtp } from "@/lib/otp";
import { sendSms } from "@/lib/sms";
import PushDevice from "@/lib/models/PushDevice";
import { sendPush } from "@/lib/push";
import { hashResetCode, normalizePhone } from "@/lib/password";
import { handleApiError, clientIp, rateLimit } from "@/lib/api-utils";

const RESEND_COOLDOWN_MS = 60 * 1000;

// 비밀번호 찾기 1단계 — 가입된 번호면 인증번호를 앱 알림(등록된 기기)과 문자(설정된 경우)로 보낸다. 번호가 가입돼 있는지 여부를
// 밖에서 알아낼 수 없도록, 가입 여부와 상관없이 항상 같은 응답을 준다.
export async function POST(req: Request) {
  try {
    const { phone: rawPhone } = await req.json();
    const phone = normalizePhone(rawPhone);
    if (phone.length < 9) return NextResponse.json({ error: "PHONE_REQUIRED" }, { status: 400 });

    rateLimit(`pw-forgot-ip:${clientIp(req)}`, 10, 10 * 60 * 1000);
    rateLimit(`pw-forgot-phone:${phone}`, 5, 60 * 60 * 1000);

    await dbConnect();
    const user = await User.findOne({ phone }).select("role").lean();
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
        const text = `비밀번호 찾기 인증번호는 ${code} 입니다. 5분 안에 입력해주세요.`;
        await sendSms(phone, `[포인트 관리] ${text}`);
        // 앱 알림 — 일반 고객 계정만(전화번호만으로 기기를 등록하는 방식이라 권한 계정에는 쓰지 않는다)
        if (user.role === "user") {
          const devices = await PushDevice.find({ phone }).lean();
          const results = await Promise.all(
            devices.map(async (d) => ({
              id: d._id,
              r: await sendPush({ endpoint: d.endpoint, p256dh: d.p256dh, auth: d.auth }, { title: "포인트 관리", body: text, url: "/forgot-password" }),
            }))
          );
          const gone = results.filter((x) => x.r === "gone").map((x) => x.id);
          if (gone.length) await PushDevice.deleteMany({ _id: { $in: gone } });
        }
      }
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return handleApiError(e);
  }
}
