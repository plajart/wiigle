import { NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import { requireSession, assertStoreScope } from "@/lib/rbac";
import PosTerminal from "@/lib/models/PosTerminal";
import { handleApiError } from "@/lib/api-utils";

// 매장 관리자: 등록된 POS 터미널 해지(더 이상 결제/조회 API를 쓸 수 없게 함)
export async function DELETE(_req: Request, { params }: { params: Promise<{ storeId: string; terminalId: string }> }) {
  try {
    await dbConnect();
    const session = await requireSession();
    const { storeId, terminalId } = await params;
    await assertStoreScope(session, storeId);

    const terminal = await PosTerminal.findOne({ _id: terminalId, storeId });
    if (!terminal) return NextResponse.json({ error: "TERMINAL_NOT_FOUND" }, { status: 404 });

    terminal.status = "REVOKED";
    await terminal.save();

    return NextResponse.json({ ok: true });
  } catch (e) {
    return handleApiError(e);
  }
}
