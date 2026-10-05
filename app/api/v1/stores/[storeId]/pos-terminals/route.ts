import { NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import { requireSession, assertStoreScope } from "@/lib/rbac";
import PosTerminal from "@/lib/models/PosTerminal";
import { handleApiError } from "@/lib/api-utils";

const ONLINE_WINDOW_MS = 2 * 60 * 1000; // 2분 이내 하트비트면 "가동중"

export async function GET(_req: Request, { params }: { params: Promise<{ storeId: string }> }) {
  try {
    await dbConnect();
    const session = await requireSession();
    const { storeId } = await params;
    await assertStoreScope(session, storeId);

    const terminals = await PosTerminal.find({ storeId }).sort({ registeredAt: -1 }).lean();
    const now = Date.now();
    const result = terminals.map((t) => ({
      _id: t._id,
      name: t.name,
      status: t.status,
      registeredAt: t.registeredAt,
      lastSeenAt: t.lastSeenAt ?? null,
      isPrimary: t.isPrimary === true,
      agentStatus: t.agentStatus ?? null,
      initialTransferAt: t.initialTransferAt ?? null,
      agentVersion: t.agentVersion ?? null,
      online: t.status === "ACTIVE" && !!t.lastSeenAt && now - new Date(t.lastSeenAt).getTime() < ONLINE_WINDOW_MS,
    }));

    return NextResponse.json({ terminals: result });
  } catch (e) {
    return handleApiError(e);
  }
}

// 매장 관리자: "대표 포스기" 지정 — 지정한 단말만 true로 두고 매장 내 나머지는 자동 해제한다.
// 대표 포스기는 관리모드(웹 화면과 동일) 바로가기를, 나머지는 결제 적립·사용 기능만 노출한다.
export async function POST(req: Request, { params }: { params: Promise<{ storeId: string }> }) {
  try {
    await dbConnect();
    const session = await requireSession();
    const { storeId } = await params;
    await assertStoreScope(session, storeId);
    const { terminalId } = await req.json();
    if (!terminalId) return NextResponse.json({ error: "TERMINAL_ID_REQUIRED" }, { status: 400 });

    const terminal = await PosTerminal.findOne({ _id: terminalId, storeId });
    if (!terminal) return NextResponse.json({ error: "TERMINAL_NOT_FOUND" }, { status: 404 });

    await PosTerminal.updateMany({ storeId, _id: { $ne: terminalId } }, { $set: { isPrimary: false } });
    terminal.isPrimary = true;
    await terminal.save();

    return NextResponse.json({ ok: true, primaryTerminalId: String(terminal._id) });
  } catch (e) {
    return handleApiError(e);
  }
}
