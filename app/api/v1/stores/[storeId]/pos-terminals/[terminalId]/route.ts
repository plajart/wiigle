import { NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import { requireSession, assertStoreScope } from "@/lib/rbac";
import PosTerminal from "@/lib/models/PosTerminal";
import { handleApiError } from "@/lib/api-utils";

// 매장 관리자: 포스 단말기 이름 변경(기본은 등록 순서대로 POS001, POS002…)
export async function PATCH(req: Request, { params }: { params: Promise<{ storeId: string; terminalId: string }> }) {
  try {
    await dbConnect();
    const session = await requireSession();
    const { storeId, terminalId } = await params;
    await assertStoreScope(session, storeId);
    const { name } = await req.json().catch(() => ({}));
    const trimmed = typeof name === "string" ? name.trim().slice(0, 50) : "";
    if (!trimmed) return NextResponse.json({ error: "NAME_REQUIRED" }, { status: 400 });
    const dup = await PosTerminal.exists({ storeId, name: trimmed, _id: { $ne: terminalId }, status: "ACTIVE" });
    if (dup) return NextResponse.json({ error: "NAME_IN_USE" }, { status: 409 });
    let terminal;
    try {
      terminal = await PosTerminal.findOneAndUpdate({ _id: terminalId, storeId }, { name: trimmed }, { new: true });
    } catch (e) {
      if ((e as { code?: number }).code === 11000) return NextResponse.json({ error: "NAME_IN_USE" }, { status: 409 });
      throw e;
    }
    if (!terminal) return NextResponse.json({ error: "TERMINAL_NOT_FOUND" }, { status: 404 });
    return NextResponse.json({ ok: true, name: terminal.name });
  } catch (e) {
    return handleApiError(e);
  }
}

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
