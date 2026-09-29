import { NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import { requireOwnStore } from "@/lib/rbac";
import { lookupCustomerByPhone, getMyPointSummary } from "@/lib/points";
import Store from "@/lib/models/Store";
import { handleApiError } from "@/lib/api-utils";

// POS 터미널(매장 관리자 로그인)에서 고객 포인트 조회 — read_balance 스코프 동의 필요.
// 조회는 전화번호로만 한다(카드는 신원 증거로 쓰지 않음, 2026-09-27 결정). 카운터 단말(챔프)
// 자체 잔액을 원격으로 가져오는 옛 vendor-http-adapter 경로는 이제 안 쓴다 — 그 경로가
// 도달할 수 없는 사설 IP(vendorApi.baseUrl)를 그대로 fetch하다 예외가 나서 "internal error"로
// 보이던 결함이었다(2026-09-27 발견·제거). 지금은 포스 에이전트가 서버로 직접 밀어넣는
// 구조라 이 조회는 우리 원장(HQ) 잔액만 보여주면 충분하다.
export async function GET(_req: Request, { params }: { params: Promise<{ phone: string }> }) {
  try {
    await dbConnect();
    const session = await requireOwnStore();
    const { phone } = await params;

    const store = await Store.findById(session.storeManagerOf);
    if (!store || !store.posIntegration.scopes.includes("read_balance")) {
      return NextResponse.json({ error: "READ_BALANCE_NOT_CONSENTED" }, { status: 403 });
    }

    const customer = await lookupCustomerByPhone(phone);
    if (!customer) {
      return NextResponse.json({ error: "CUSTOMER_NOT_FOUND" }, { status: 404 });
    }

    const summary = await getMyPointSummary(String(customer._id));
    const myStoreBalance = summary.stores.find((s) => s.storeId === session.storeManagerOf)?.balance ?? 0;
    const hq = { customerId: String(customer._id), name: customer.name, myStoreBalance, total: summary.total };

    return NextResponse.json({ hq });
  } catch (e) {
    return handleApiError(e);
  }
}
