import { NextResponse } from "next/server";
import QRCode from "qrcode";
import { dbConnect } from "@/lib/mongodb";
import { requireSession, assertStoreScope } from "@/lib/rbac";
import { handleApiError } from "@/lib/api-utils";

// 매장 고정 QR 스티커(카운터/테이블용) — 가입 페이지로 연결. CHAMP 카드번호와는 무관한
// 순수 가입 유도 채널이며, 나중에 매장에서 카드 연결(전화번호 확인 또는 방법2)로 이어진다.
export async function GET(_req: Request, { params }: { params: Promise<{ storeId: string }> }) {
  try {
    await dbConnect();
    const session = await requireSession();
    const { storeId } = await params;
    await assertStoreScope(session, storeId);

    const signupUrl = `https://concrab.com/signup?store=${storeId}`;
    const qrDataUrl = await QRCode.toDataURL(signupUrl, {
      margin: 1,
      width: 320,
      color: { dark: "#1c2541", light: "#ffffff" },
    });

    return NextResponse.json({ signupUrl, qrDataUrl });
  } catch (e) {
    return handleApiError(e);
  }
}
