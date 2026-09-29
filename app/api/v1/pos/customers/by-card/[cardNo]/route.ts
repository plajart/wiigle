import { NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import { requireOwnStore } from "@/lib/rbac";
import { lookupCustomerByPosCard, getMyPointSummary } from "@/lib/points";
import { handleApiError } from "@/lib/api-utils";

// 이전에 link-card로 연결해둔 POS 카드번호로 고객을 조회한다(전화번호 재입력 없이 인식).
export async function GET(_req: Request, { params }: { params: Promise<{ cardNo: string }> }) {
  try {
    await dbConnect();
    const session = await requireOwnStore();
    const { cardNo } = await params;

    const customer = await lookupCustomerByPosCard(session.storeManagerOf, cardNo);
    if (!customer) return NextResponse.json({ error: "CARD_NOT_LINKED" }, { status: 404 });

    const summary = await getMyPointSummary(String(customer._id));
    const myStoreBalance = summary.stores.find((s) => s.storeId === session.storeManagerOf)?.balance ?? 0;

    return NextResponse.json({
      customerId: String(customer._id),
      name: customer.name,
      phone: customer.phone,
      myStoreBalance,
      total: summary.total,
    });
  } catch (e) {
    return handleApiError(e);
  }
}
