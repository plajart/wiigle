import { NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import { posAgentEarn, posAgentEarnCancel } from "@/lib/points";
import { handleApiError, requireAgentTerminal } from "@/lib/api-utils";

// 결제완료 트리거(에이전트)가 호출 — 전화번호가 확인된(회원 레코드에 등록된) 거래만 적립한다.
// 전화번호가 없는 거래는 에이전트가 이 API를 아예 호출하지 않는다(설계 2026-09-27).
// 인증: Authorization: Bearer <apiKey>
export async function POST(req: Request) {
  try {
    await dbConnect();
    const { store, storeId, terminalId } = await requireAgentTerminal(req);
    if (!store.posIntegration.scopes.includes("write_earn")) {
      return NextResponse.json({ error: "WRITE_EARN_NOT_CONSENTED" }, { status: 403 });
    }

    const body = await req.json();
    const phone: string = typeof body.phone === "string" || typeof body.phone === "number" ? String(body.phone) : "";
    const addAmount: number = Number(body.addAmount);
    const saleAmount: number | undefined = typeof body.saleAmount === "number" ? body.saleAmount : undefined;
    const cardNo: string | undefined = body.cardNo || undefined;
    const vendorTxnId: string = body.vendorTxnId;
    const existingVendorBalance: number | null = typeof body.existingVendorBalance === "number" ? body.existingVendorBalance : null;
    if (!phone) return NextResponse.json({ error: "PHONE_REQUIRED" }, { status: 400 });
    if (!vendorTxnId) return NextResponse.json({ error: "VENDOR_TXN_ID_REQUIRED" }, { status: 400 });
    if (!Number.isFinite(addAmount) || addAmount === 0) return NextResponse.json({ error: "INVALID_AMOUNT" }, { status: 400 });
    const occurredAt: string | undefined = typeof body.occurredAt === "string" ? body.occurredAt : undefined;

    // 음수 = 결제 취소로 포스가 적립을 되돌린 건 → 서버에서도 같은 금액을 자동 차감한다.
    if (addAmount < 0) {
      const cancel = await posAgentEarnCancel({ storeId, terminalId, phone, cancelAmount: -addAmount, cardNo, vendorTxnId, occurredAt });
      return NextResponse.json({ ok: true, cancelled: true, ...cancel });
    }

    const result = await posAgentEarn({ storeId, terminalId, phone, addAmount, saleAmount, cardNo, vendorTxnId, existingVendorBalance, occurredAt });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return handleApiError(e);
  }
}
