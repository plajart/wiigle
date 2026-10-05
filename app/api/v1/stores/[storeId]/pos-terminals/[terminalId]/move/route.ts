import { NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import { requireCompanyAdmin, assertStoreScope, ApiError } from "@/lib/rbac";
import PosTerminal from "@/lib/models/PosTerminal";
import Store from "@/lib/models/Store";
import AuditLog from "@/lib/models/AuditLog";
import { handleApiError } from "@/lib/api-utils";
import { publishPointChange } from "@/lib/realtime";
import { nextTerminalName, isDuplicateKey } from "@/lib/pos-terminal-name";

// 등록된 포스기를 다른 매장으로 옮긴다.
// - 본사(owner): 어느 고객사·매장으로든 이동 가능.
// - 고객사 운영자(admin): 자기 고객사 안의 매장끼리만 이동 가능.
// - 매장 관리자(manager): 이동 불가(403).
// 서버에 아직 못 보낸 결제가 남아 있으면(오프라인 등) 거래가 엉뚱한 매장에 반영되므로 이동을 막는다(PENDING_UNSENT).
export async function POST(req: Request, { params }: { params: Promise<{ storeId: string; terminalId: string }> }) {
  try {
    await dbConnect();
    const session = await requireCompanyAdmin(); // owner·admin만 (manager는 403)
    const { storeId, terminalId } = await params;
    await assertStoreScope(session, storeId);
    const { targetStoreId } = await req.json().catch(() => ({}));
    if (!targetStoreId || typeof targetStoreId !== "string") return NextResponse.json({ error: "TARGET_STORE_REQUIRED" }, { status: 400 });
    if (targetStoreId === storeId) return NextResponse.json({ error: "SAME_STORE" }, { status: 400 });
    await assertStoreScope(session, targetStoreId); // 운영자는 자기 고객사 매장으로만

    const [terminal, target, source] = await Promise.all([
      PosTerminal.findOne({ _id: terminalId, storeId, status: "ACTIVE" }),
      Store.findById(targetStoreId).select("name companyId").lean(),
      Store.findById(storeId).select("name companyId").lean(),
    ]);
    if (!terminal) return NextResponse.json({ error: "TERMINAL_NOT_FOUND" }, { status: 404 });
    if (!target) return NextResponse.json({ error: "TARGET_STORE_NOT_FOUND" }, { status: 404 });
    if ((terminal.agentStatus?.pending ?? 0) > 0) throw new ApiError(409, "PENDING_UNSENT");

    // 이동한 매장에 같은 이름의 포스기가 있으면 새 일련번호를 받는다. 이동하면 그 매장의 대표 포스기는 따로 지정하기 전까지 기존 대표를 유지한다.
    const siblings = await PosTerminal.find({ storeId: targetStoreId }).select("name isPrimary status").lean();
    let name = terminal.name;
    if (siblings.some((t) => t.name === name && t.status === "ACTIVE")) name = await nextTerminalName(targetStoreId);
    const hadPrimary = siblings.some((t) => t.status === "ACTIVE" && t.isPrimary);

    terminal.storeId = target._id;
    terminal.isPrimary = !hadPrimary; // 옮겨 간 매장에 대표가 없으면 이 포스기가 대표
    for (let attempt = 0; attempt < 6; attempt++) {
      terminal.name = name;
      try {
        await terminal.save();
        break;
      } catch (e) {
        if (!isDuplicateKey(e) || attempt === 5) throw e;
        name = await nextTerminalName(targetStoreId, attempt + 1); // 동시에 같은 이름이 생긴 경우 다음 번호로
      }
    }

    await AuditLog.create({
      storeId: target._id,
      actorType: "HQ_ADMIN",
      actorId: session.sub,
      action: "POS_TERMINAL_MOVED",
      meta: { terminalId, fromStoreId: storeId, fromStoreName: source?.name, toStoreId: String(target._id), toStoreName: target.name, fromCompanyId: String(source?.companyId), toCompanyId: String(target.companyId), name },
    });
    publishPointChange({ storeId, companyId: String(source?.companyId) }, "TERMINAL_MOVED");
    publishPointChange({ storeId: String(target._id), companyId: String(target.companyId) }, "TERMINAL_MOVED");
    return NextResponse.json({ ok: true, storeId: String(target._id), storeName: target.name, name });
  } catch (e) {
    return handleApiError(e);
  }
}
