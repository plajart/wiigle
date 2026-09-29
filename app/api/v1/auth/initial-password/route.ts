import { NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import User from "@/lib/models/User";
import { normalizePhone } from "@/lib/password";
import { handleApiError, clientIp, rateLimit } from "@/lib/api-utils";

// 로그인 화면의 "처음 로그인하시나요?" — 매장(POS)에서 자동으로 만들어져 아직 한 번도 로그인하지 않은 일반 고객 계정이면
// 그 임의 초기 비밀번호를 알려준다. 로그인이 성공하면 원문이 DB에서 지워지므로 그 뒤로는 null만 돌려준다.
// 일반 고객(role=user) 계정만 대상이다 — 소유자·운영자·매장 관리자의 비밀번호는 절대 여기서 알려주지 않는다.
//
// ⚠ 신원 근거가 전화번호뿐인 설계상, 이 번호를 아는 사람은 누구나 초기 비밀번호를 볼 수 있다(먼저 로그인해 비밀번호를
//   바꾸면 그 사람이 계정을 차지). 남용을 줄이려고 IP당·번호당 요청 횟수를 제한한다.
export async function POST(req: Request) {
  try {
    const { phone: rawPhone } = await req.json();
    const phone = normalizePhone(rawPhone);
    if (phone.length < 9) return NextResponse.json({ error: "PHONE_REQUIRED" }, { status: 400 });

    rateLimit(`initpw-ip:${clientIp(req)}`, 15, 10 * 60 * 1000);
    rateLimit(`initpw-phone:${phone}`, 5, 60 * 60 * 1000);

    await dbConnect();
    const user = await User.findOne({ phone: { $in: [phone, String(rawPhone)] } }).select("role initialPassword").lean();
    const initialPassword = user && user.role === "user" && user.initialPassword ? user.initialPassword : null;
    return NextResponse.json({ initialPassword });
  } catch (e) {
    return handleApiError(e);
  }
}
