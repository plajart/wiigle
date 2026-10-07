import { NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import { requireOwner } from "@/lib/rbac";
import AuditLog from "@/lib/models/AuditLog";
import { getOpsSwitches, setOpsSwitch } from "@/lib/ops-switches";
import { handleApiError } from "@/lib/api-utils";

// 본사: 긴급 스위치 — autoInjectAllowed(고객 조회 시 통합포인트 자동 반영 허용), redeemPaused(포인트 사용 조회 일시 중지).
export async function GET() {
  try {
    await requireOwner();
    return NextResponse.json(await getOpsSwitches());
  } catch (e) {
    return handleApiError(e);
  }
}

export async function PATCH(req: Request) {
  try {
    await dbConnect();
    const session = await requireOwner();
    const body = await req.json().catch(() => ({}));
    const name = body.name;
    if ((name !== "autoInjectAllowed" && name !== "redeemPaused") || typeof body.value !== "boolean") return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 });
    await setOpsSwitch(name, body.value, session.sub);
    await AuditLog.create({ storeId: null, actorType: "HQ_ADMIN", actorId: session.sub, action: "OPS_SWITCH_CHANGED", meta: { name, value: body.value } });
    return NextResponse.json({ ok: true, ...(await getOpsSwitches()) });
  } catch (e) {
    return handleApiError(e);
  }
}
