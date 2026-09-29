import { NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import { requireSession } from "@/lib/rbac";
import ClaimToken from "@/lib/models/ClaimToken";
import { linkPosCard } from "@/lib/points";
import { handleApiError } from "@/lib/api-utils";

// 로그인한 회원이 영수증 QR의 토큰으로 "이 카드번호 = 내 계정"을 확정한다. 1회 사용 후 토큰 소모.
export async function POST(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    await dbConnect();
    const session = await requireSession();
    const { token } = await params;

    const claim = await ClaimToken.findOne({ token });
    if (!claim) return NextResponse.json({ error: "INVALID_OR_EXPIRED_TOKEN" }, { status: 404 });

    await linkPosCard(String(claim.storeId), session.sub, claim.cardNo, session.sub);
    await ClaimToken.deleteOne({ _id: claim._id });

    return NextResponse.json({ ok: true, cardNo: claim.cardNo });
  } catch (e) {
    return handleApiError(e);
  }
}
