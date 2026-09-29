import { NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import User from "@/lib/models/User";
import StoreApplication from "@/lib/models/StoreApplication";
import { hashPassword } from "@/lib/auth";
import { checkNewPassword, normalizePhone } from "@/lib/password";
import { handleApiError, clientIp, rateLimit } from "@/lib/api-utils";

const clip = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

// 고객사·매장 등록 신청 (비로그인, 셀프서비스). 본사(소유자)가 승인하기 전까지는 로그인 가능한 계정이 생기지 않는다.
// 공개 API라 스팸·대량 신청을 막기 위해 IP당 요청 횟수를 제한한다.
export async function POST(req: Request) {
  try {
    rateLimit(`store-app:${clientIp(req)}`, 5, 60 * 60 * 1000);

    await dbConnect();
    const body = await req.json();
    const type = body.type === "ADD_STORE" ? "ADD_STORE" : "NEW_COMPANY";
    const companyName = clip(body.companyName, 100);
    const storeName = clip(body.storeName, 100);
    const franchiseCode = clip(body.franchiseCode, 50) || undefined;
    const applicantName = clip(body.applicantName, 50);
    const applicantPhone = normalizePhone(body.applicantPhone);
    const password = body.password;
    if (!companyName || !storeName || !applicantName || applicantPhone.length < 9 || !password) {
      return NextResponse.json({ error: "MISSING_FIELDS" }, { status: 400 });
    }
    const pwError = checkNewPassword(password);
    if (pwError) return NextResponse.json({ error: pwError }, { status: 400 });

    const dupUser = await User.findOne({ phone: { $in: [applicantPhone, String(body.applicantPhone)] } }).select("_id").lean();
    if (dupUser) return NextResponse.json({ error: "PHONE_ALREADY_USED" }, { status: 409 });

    const dupApp = await StoreApplication.findOne({ applicantPhone, status: "PENDING" });
    if (dupApp) return NextResponse.json({ error: "APPLICATION_ALREADY_PENDING" }, { status: 409 });

    const passwordHash = await hashPassword(password);
    const application = await StoreApplication.create({
      type,
      companyName,
      storeName,
      franchiseCode,
      applicantName,
      applicantPhone,
      passwordHash,
      status: "PENDING",
    });

    return NextResponse.json({ ok: true, applicationId: application._id });
  } catch (e) {
    return handleApiError(e);
  }
}
