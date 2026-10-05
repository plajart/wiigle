import { NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import { requireOwner } from "@/lib/rbac";
import { rolloutStatus, startRollout, cancelRollout } from "@/lib/agent-rollout";
import { handleApiError } from "@/lib/api-utils";

// 본사: 포스 프로그램 전체 순차 업데이트 — 현황 조회 / 시작 / 중단.
export async function GET() {
  try {
    await dbConnect();
    await requireOwner();
    return NextResponse.json(await rolloutStatus());
  } catch (e) {
    return handleApiError(e);
  }
}

export async function POST(req: Request) {
  try {
    await dbConnect();
    const session = await requireOwner();
    const { action } = await req.json().catch(() => ({}));
    if (action === "start") await startRollout(session.sub);
    else if (action === "cancel") await cancelRollout(session.sub);
    else return NextResponse.json({ error: "INVALID_ACTION" }, { status: 400 });
    return NextResponse.json({ ok: true, ...(await rolloutStatus()) });
  } catch (e) {
    return handleApiError(e);
  }
}
