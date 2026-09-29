import { NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import PosTerminal from "@/lib/models/PosTerminal";
import Store from "@/lib/models/Store";
import { lookupCustomerByPosCard, applyVendorSync, type VendorSyncEvent } from "@/lib/points";
import { handleApiError } from "@/lib/api-utils";

// 벤더(챔프 등) POS 터미널에 상주하는 에이전트가 주기적으로 호출 — 로컬 DB에서
// 새로 발생한 적립/사용을 우리 원장에 반영하고, 그 결과 이 카드로 지금 당장 쓸 수
// 있는 "가용" 총액을 돌려준다. 에이전트는 이 값을 벤더 POS의 회원 잔액 필드에
// 그대로 써서 계산원 화면에 보이게 한다.
// 인증: Authorization: Bearer <apiKey> (터미널 등록 시 발급된 값, heartbeat와 동일)
export async function POST(req: Request) {
  try {
    await dbConnect();
    const auth = req.headers.get("authorization") ?? "";
    const apiKey = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (!apiKey) return NextResponse.json({ error: "API_KEY_REQUIRED" }, { status: 401 });

    const terminal = await PosTerminal.findOne({ apiKey });
    if (!terminal) return NextResponse.json({ error: "INVALID_API_KEY" }, { status: 401 });
    if (terminal.status !== "ACTIVE") return NextResponse.json({ error: "TERMINAL_REVOKED" }, { status: 403 });

    const store = await Store.findById(terminal.storeId);
    if (!store) return NextResponse.json({ error: "STORE_NOT_FOUND" }, { status: 404 });
    if (!store.posIntegration.scopes.includes("write_redeem")) {
      return NextResponse.json({ error: "WRITE_REDEEM_NOT_CONSENTED" }, { status: 403 });
    }

    const body = await req.json();
    const cardNo: string = body.cardNo;
    const events: VendorSyncEvent[] = Array.isArray(body.events) ? body.events : [];
    const localBalance: number | null = typeof body.localBalance === "number" ? body.localBalance : null;
    if (!cardNo) return NextResponse.json({ error: "CARD_NO_REQUIRED" }, { status: 400 });

    const storeId = String(terminal.storeId);
    const customer = await lookupCustomerByPosCard(storeId, cardNo);
    if (!customer) {
      // 아직 우리 시스템에 연결(link-card)되지 않은 카드 — 에이전트는 이 카드에 대해
      // 아무것도 쓰지 말고 그대로 둔다(벤더 자체 로컬 포인트만 계속 쓰는 손님).
      return NextResponse.json({ linked: false });
    }

    terminal.lastSeenAt = new Date();
    await terminal.save();

    const result = await applyVendorSync(storeId, String(customer._id), events, localBalance, String(terminal._id));
    return NextResponse.json({ linked: true, ...result });
  } catch (e) {
    return handleApiError(e);
  }
}
