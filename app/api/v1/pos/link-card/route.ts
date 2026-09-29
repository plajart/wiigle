import { NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import { requireOwnStore } from "@/lib/rbac";
import { linkPosCard } from "@/lib/points";
import Store from "@/lib/models/Store";
import { handleApiError } from "@/lib/api-utils";

// 매장 관리자(계산원)가 결제 시 전화번호로 고객을 확인한 뒤, POS 회원카드 식별번호를
// 그 고객 계정에 연결한다. 다음부터는 카드번호만으로 같은 고객을 인식하는 데 쓰인다.
export async function POST(req: Request) {
  try {
    await dbConnect();
    const session = await requireOwnStore();
    const { customerId, cardNo } = await req.json();
    if (!customerId || !cardNo) {
      return NextResponse.json({ error: "CUSTOMER_ID_AND_CARD_NO_REQUIRED" }, { status: 400 });
    }

    const store = await Store.findById(session.storeManagerOf);
    if (!store) return NextResponse.json({ error: "STORE_NOT_FOUND" }, { status: 404 });

    const result = await linkPosCard(session.storeManagerOf, customerId, cardNo, String(session.sub));
    return NextResponse.json(result);
  } catch (e) {
    return handleApiError(e);
  }
}
