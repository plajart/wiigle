import { NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import ClaimToken from "@/lib/models/ClaimToken";
import Store from "@/lib/models/Store";
import { handleApiError } from "@/lib/api-utils";

// 공개 — QR을 스캔한 손님이 어느 매장 건인지 확인하는 용도(카드번호는 노출 안 함).
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    await dbConnect();
    const { token } = await params;
    const claim = await ClaimToken.findOne({ token });
    if (!claim) return NextResponse.json({ error: "INVALID_OR_EXPIRED_TOKEN" }, { status: 404 });

    const store = await Store.findById(claim.storeId).select("name").lean();
    return NextResponse.json({ ok: true, storeName: store?.name ?? "매장" });
  } catch (e) {
    return handleApiError(e);
  }
}
