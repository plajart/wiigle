import { NextResponse } from "next/server";
import crypto from "crypto";
import QRCode from "qrcode";
import { dbConnect } from "@/lib/mongodb";
import { requireOwnStore } from "@/lib/rbac";
import ClaimToken from "@/lib/models/ClaimToken";
import { handleApiError } from "@/lib/api-utils";

// 미가입 카드 소지자용 — 영수증에 인쇄할(또는 지금은 계산원이 화면으로 보여줄) QR 토큰 발급
// (30분 유효, 1회용). POS 에이전트 자동화 전까지는 계산원이 POS 터미널 화면에서 수동 발급한다.
export async function POST(req: Request) {
  try {
    await dbConnect();
    const session = await requireOwnStore();
    const { cardNo } = await req.json();
    if (!cardNo) return NextResponse.json({ error: "CARD_NO_REQUIRED" }, { status: 400 });

    const token = crypto.randomBytes(12).toString("hex");
    await ClaimToken.create({ token, storeId: session.storeManagerOf, cardNo: String(cardNo).trim() });

    const claimUrl = `https://concrab.com/claim/${token}`;
    const qrDataUrl = await QRCode.toDataURL(claimUrl, {
      margin: 1,
      width: 260,
      color: { dark: "#1c2541", light: "#ffffff" },
    });

    return NextResponse.json({ ok: true, token, claimUrl, qrDataUrl });
  } catch (e) {
    return handleApiError(e);
  }
}
