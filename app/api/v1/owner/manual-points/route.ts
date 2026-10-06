import { NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import { requireOwner } from "@/lib/rbac";
import AuditLog from "@/lib/models/AuditLog";
import { isManualPointChangesEnabled, setManualPointChangesEnabled } from "@/lib/manual-points";
import { handleApiError } from "@/lib/api-utils";

// 본사: 챔프 외 임의 포인트 변경(웹 수동 적립·사용, 통합포인트 지급·조정) 허용 스위치. 기본은 꺼짐.
export async function GET() {
  try {
    await dbConnect();
    await requireOwner();
    return NextResponse.json({ enabled: await isManualPointChangesEnabled() });
  } catch (e) {
    return handleApiError(e);
  }
}

export async function PATCH(req: Request) {
  try {
    await dbConnect();
    const session = await requireOwner();
    const { enabled } = await req.json().catch(() => ({}));
    if (typeof enabled !== "boolean") return NextResponse.json({ error: "ENABLED_REQUIRED" }, { status: 400 });
    await setManualPointChangesEnabled(enabled, session.sub);
    await AuditLog.create({ storeId: null, actorType: "HQ_ADMIN", actorId: session.sub, action: enabled ? "MANUAL_POINTS_ENABLE" : "MANUAL_POINTS_DISABLE", meta: {} });
    return NextResponse.json({ ok: true, enabled });
  } catch (e) {
    return handleApiError(e);
  }
}
