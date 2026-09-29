import { NextResponse } from "next/server";
import QRCode from "qrcode";
import { dbConnect } from "@/lib/mongodb";
import { requireSession } from "@/lib/rbac";
import User from "@/lib/models/User";
import { handleApiError } from "@/lib/api-utils";

// 내 디지털 회원카드 QR — 카운터 단말의 2D 스캐너로 스캔하면 카드번호가 그대로 입력된다.
export async function GET() {
  try {
    await dbConnect();
    const session = await requireSession();
    const user = await User.findById(session.sub).select("digitalCardNo").lean();
    if (!user) return NextResponse.json({ error: "USER_NOT_FOUND" }, { status: 404 });

    const qrDataUrl = await QRCode.toDataURL(user.digitalCardNo, {
      margin: 1,
      width: 280,
      color: { dark: "#1c2541", light: "#ffffff" },
    });

    return NextResponse.json({ cardNo: user.digitalCardNo, qrDataUrl });
  } catch (e) {
    return handleApiError(e);
  }
}
