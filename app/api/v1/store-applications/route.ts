import { NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import User from "@/lib/models/User";
import StoreApplication from "@/lib/models/StoreApplication";
import { hashPassword } from "@/lib/auth";
import { handleApiError } from "@/lib/api-utils";

// 매장주 셀프서비스 가입 신청 (비로그인). 본사 승인 전까지는 로그인 가능한 계정이 생기지 않는다.
export async function POST(req: Request) {
  try {
    await dbConnect();
    const { companyName, storeName, franchiseCode, applicantName, applicantPhone, password } = await req.json();
    if (!companyName || !storeName || !applicantName || !applicantPhone || !password) {
      return NextResponse.json({ error: "MISSING_FIELDS" }, { status: 400 });
    }
    if (password.length < 8) {
      return NextResponse.json({ error: "PASSWORD_TOO_SHORT" }, { status: 400 });
    }

    const dupUser = await User.findOne({ phone: applicantPhone });
    if (dupUser) return NextResponse.json({ error: "PHONE_ALREADY_USED" }, { status: 409 });

    const dupApp = await StoreApplication.findOne({ applicantPhone, status: "PENDING" });
    if (dupApp) return NextResponse.json({ error: "APPLICATION_ALREADY_PENDING" }, { status: 409 });

    const passwordHash = await hashPassword(password);
    const application = await StoreApplication.create({
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
