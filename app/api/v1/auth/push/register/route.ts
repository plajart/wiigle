import { NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import User from "@/lib/models/User";
import PushDevice from "@/lib/models/PushDevice";
import { isAllowedPushEndpoint, isPushConfigured, sendPush } from "@/lib/push";
import { normalizePhone } from "@/lib/password";
import { handleApiError, clientIp, rateLimit } from "@/lib/api-utils";

const MAX_DEVICES_PER_PHONE = 3;

// 로그인 전(비밀번호를 모르는 상태)에 "이 기기로 비밀번호 찾기 알림을 받겠다"고 등록한다.
// 가입 여부와 무관하게 항상 같은 응답을 준다. 일반 고객(role=user) 번호만 실제로 저장하고,
// 소유자·운영자·매장 관리자 계정은 이 방식(전화번호만으로 기기 등록)을 허용하지 않는다.
export async function POST(req: Request) {
  try {
    if (!isPushConfigured()) return NextResponse.json({ error: "PUSH_NOT_CONFIGURED" }, { status: 503 });
    const body = await req.json();
    const phone = normalizePhone(body.phone);
    const sub = body.subscription;
    const endpoint = sub?.endpoint;
    const p256dh = sub?.keys?.p256dh;
    const auth = sub?.keys?.auth;
    if (phone.length < 9 || !isAllowedPushEndpoint(endpoint) || typeof p256dh !== "string" || typeof auth !== "string") {
      return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 });
    }

    rateLimit(`push-reg-ip:${clientIp(req)}`, 10, 10 * 60 * 1000);
    rateLimit(`push-reg-phone:${phone}`, 5, 60 * 60 * 1000);

    await dbConnect();
    const user = await User.findOne({ phone }).select("role").lean();
    if (user && user.role === "user") {
      const before = await PushDevice.find({ phone, endpoint: { $ne: endpoint } }).sort({ createdAt: 1 }).lean();

      await PushDevice.findOneAndUpdate(
        { endpoint },
        { phone, endpoint, p256dh, auth, createdAt: new Date() },
        { upsert: true, setDefaultsOnInsert: true }
      );

      // 이미 다른 기기가 등록돼 있었다면, 본인이 모르는 새 기기 등록일 수 있으니 기존 기기들에 알린다.
      await Promise.all(
        before.map((d) =>
          sendPush(
            { endpoint: d.endpoint, p256dh: d.p256dh, auth: d.auth },
            { title: "포인트 관리", body: "새 기기에서 비밀번호 찾기가 요청되었습니다. 본인이 아니라면 무시하세요." }
          )
        )
      );

      // 번호당 최대 3대 — 초과분(오래된 것)은 삭제
      const all = await PushDevice.find({ phone }).sort({ createdAt: -1 }).select("_id").lean();
      const stale = all.slice(MAX_DEVICES_PER_PHONE).map((d) => d._id);
      if (stale.length) await PushDevice.deleteMany({ _id: { $in: stale } });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return handleApiError(e);
  }
}
