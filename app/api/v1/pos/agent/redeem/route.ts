import { NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import { posAgentRedeemLookup, posAgentRedeemApply, posAgentRedeemCancel, RedeemBusyError } from "@/lib/points";
import { handleApiError, requireAgentTerminal } from "@/lib/api-utils";

// 사용(REDEEM) 팝업이 호출 — 전화번호로 조회(GET 성격이지만 인증 헤더 때문에 POST로 통일)한다.
// 신규 손님이면 그 자리에서 계정을 만들고 가용 잔액(0원)을 돌려준다.
// { action: "lookup", phone } → 팝업에 표시할 가용 잔액(에이전트가 이 값을 MEMBER.MEM_USABLE_PNT에 잠시 써넣는다)
// { action: "apply", phone, usedAmount, cardNo, vendorTxnId } → 결제완료 트리거가 실제 사용액을 사후 차감
export async function POST(req: Request) {
  try {
    await dbConnect();
    const { store, storeId, terminalId } = await requireAgentTerminal(req);
    if (!store.posIntegration.scopes.includes("write_redeem")) {
      return NextResponse.json({ error: "WRITE_REDEEM_NOT_CONSENTED" }, { status: 403 });
    }

    const body = await req.json();
    const phone: string = typeof body.phone === "string" || typeof body.phone === "number" ? String(body.phone) : "";
    if (!phone) return NextResponse.json({ error: "PHONE_REQUIRED" }, { status: 400 });

    if (body.action === "lookup") {
      try {
        const result = await posAgentRedeemLookup(storeId, terminalId, phone);
        return NextResponse.json({ ok: true, ...result });
      } catch (e) {
        // 다른 포스기가 이 손님을 사용 조회 중 — 어디서 쓰는 중인지 알려준다(이 경우 포스에서는 적립만 가능).
        if (e instanceof RedeemBusyError) {
          return NextResponse.json({ error: "REDEEM_IN_PROGRESS_ELSEWHERE", holder: e.holder }, { status: 409 });
        }
        throw e;
      }
    }
    if (body.action === "apply") {
      const usedAmount = Number(body.usedAmount);
      const cardNo: string | undefined = body.cardNo || undefined;
      const vendorTxnId: string = body.vendorTxnId;
      if (!vendorTxnId) return NextResponse.json({ error: "VENDOR_TXN_ID_REQUIRED" }, { status: 400 });
      if (!Number.isFinite(usedAmount) || usedAmount <= 0) return NextResponse.json({ error: "INVALID_AMOUNT" }, { status: 400 });
      const occurredAt: string | undefined = typeof body.occurredAt === "string" ? body.occurredAt : undefined;
      const result = await posAgentRedeemApply({ storeId, terminalId, phone, usedAmount, cardNo, vendorTxnId, occurredAt });
      return NextResponse.json({ ok: true, ...result });
    }
    if (body.action === "cancel") {
      const refundAmount = Number(body.refundAmount);
      const vendorTxnId: string = body.vendorTxnId;
      if (!vendorTxnId) return NextResponse.json({ error: "VENDOR_TXN_ID_REQUIRED" }, { status: 400 });
      if (!Number.isFinite(refundAmount) || refundAmount <= 0) return NextResponse.json({ error: "INVALID_AMOUNT" }, { status: 400 });
      const result = await posAgentRedeemCancel({ storeId, terminalId, phone, refundAmount, cardNo: body.cardNo || undefined, vendorTxnId, occurredAt: typeof body.occurredAt === "string" ? body.occurredAt : undefined });
      return NextResponse.json({ ok: true, ...result });
    }
    return NextResponse.json({ error: "INVALID_ACTION" }, { status: 400 });
  } catch (e) {
    return handleApiError(e);
  }
}
