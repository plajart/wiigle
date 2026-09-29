import { NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import { requireSession, assertStoreScope } from "@/lib/rbac";
import AuditLog from "@/lib/models/AuditLog";
import PosTerminal from "@/lib/models/PosTerminal";
import { handleApiError } from "@/lib/api-utils";

export async function GET(_req: Request, { params }: { params: Promise<{ storeId: string }> }) {
  try {
    await dbConnect();
    const { storeId } = await params;
    const session = await requireSession();
    await assertStoreScope(session, storeId);
    const logs = await AuditLog.find({ storeId }).sort({ occurredAt: -1 }).limit(200).lean();

    // AGENT 활동은 actorId가 PosTerminal._id라 화면에는 단말 이름으로 풀어서 보여준다.
    const terminalIds = [...new Set(logs.filter((l) => l.actorType === "AGENT" && l.actorId).map((l) => String(l.actorId)))];
    const terminals = terminalIds.length
      ? await PosTerminal.find({ _id: { $in: terminalIds } }).select("name").lean()
      : [];
    const terminalNameById = new Map(terminals.map((t) => [String(t._id), t.name]));
    const enriched = logs.map((l) => ({
      ...l,
      terminalName: l.actorType === "AGENT" && l.actorId ? terminalNameById.get(String(l.actorId)) ?? "(삭제된 포스기)" : undefined,
    }));

    return NextResponse.json({ logs: enriched });
  } catch (e) {
    return handleApiError(e);
  }
}
