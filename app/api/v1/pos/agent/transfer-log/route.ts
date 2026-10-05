import { NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import User from "@/lib/models/User";
import { logPosTransfer } from "@/lib/points";
import { normalizePhone } from "@/lib/password";
import { publishPointChange } from "@/lib/realtime";
import { handleApiError, requireAgentTerminal } from "@/lib/api-utils";

// 포스 프로그램이 로컬(포스DB)에서 일어난 포인트 이동·건너뜀을 서버 장부에 남긴다 — 서버가 직접 볼 수 없는 부분
// (사용 조회 때 서버 포인트를 포스에 더함, 결제 후 포스 잔액 0으로 복원, 번호 없어 보류, 서버 거부로 건너뜀).
// 잔액을 바꾸지 않는 기록 전용이다.
const KINDS = new Set(["LOOKUP_TO_POS", "RESTORE_POS", "SKIPPED", "REJECTED"]);

export async function POST(req: Request) {
  try {
    await dbConnect();
    const { storeId, terminalId } = await requireAgentTerminal(req);
    const body = await req.json().catch(() => ({}));
    const kind = String(body.kind ?? "");
    if (!KINDS.has(kind)) return NextResponse.json({ error: "INVALID_KIND" }, { status: 400 });
    const phone = normalizePhone(String(body.phone ?? ""));
    const user = phone ? await User.findOne({ phone: { $in: [phone, String(body.phone)] } }).select("_id").lean() : null;
    const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : undefined);
    await logPosTransfer({
      storeId,
      terminalId,
      userId: user ? String(user._id) : undefined,
      phone: phone || undefined,
      kind: kind as "LOOKUP_TO_POS" | "RESTORE_POS" | "SKIPPED" | "REJECTED",
      direction: kind === "LOOKUP_TO_POS" ? "SERVER_TO_POS" : kind === "RESTORE_POS" ? "POS_TO_SERVER" : "NONE",
      amount: n(body.amount) ?? 0,
      localBefore: n(body.localBefore),
      localAfter: n(body.localAfter),
      vendorTxnId: typeof body.vendorTxnId === "string" ? body.vendorTxnId.slice(0, 100) : undefined,
      note: typeof body.note === "string" ? body.note.slice(0, 300) : undefined,
    });
    publishPointChange({ storeId, userId: user ? String(user._id) : null }, "TRANSFER_LOG");
    return NextResponse.json({ ok: true });
  } catch (e) {
    return handleApiError(e);
  }
}
