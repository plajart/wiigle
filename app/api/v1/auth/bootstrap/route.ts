import { NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import User from "@/lib/models/User";
import { hashPassword } from "@/lib/auth";
import { issueDigitalCardNo } from "@/lib/card";
import { handleApiError } from "@/lib/api-utils";

// 최초 1회, owner가 하나도 없을 때만 소유자(플랫폼 최상위) 계정을 생성한다.
export async function POST(req: Request) {
  try {
    await dbConnect();
    const existing = await User.countDocuments({ role: "owner" });
    if (existing > 0) {
      return NextResponse.json({ error: "ALREADY_BOOTSTRAPPED" }, { status: 409 });
    }
    const { phone, name, password } = await req.json();
    if (!phone || !name || !password) {
      return NextResponse.json({ error: "MISSING_FIELDS" }, { status: 400 });
    }
    const passwordHash = await hashPassword(password);
    const digitalCardNo = await issueDigitalCardNo();
    const user = await User.create({
      role: "owner",
      phone,
      name,
      passwordHash,
      phoneVerified: true,
      digitalCardNo,
    });
    return NextResponse.json({ ok: true, userId: user._id });
  } catch (e) {
    return handleApiError(e);
  }
}
