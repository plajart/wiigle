import { NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import { requireOwner } from "@/lib/rbac";
import { reversePointEvent, correctBalance, releaseCustomerLocks, resolveImportHold, previewTerminalImports, reverseTerminalImports } from "@/lib/ops-actions";
import { handleApiError } from "@/lib/api-utils";

// 본사: 운영 조치. 모두 감사로그에 남는다(원장은 지우지 않고 반대 내역을 추가한다).
// { action: "reverse-event", eventId, reason }              — 내역 한 건 되돌리기
// { action: "correct-balance", userId, companyId, storeId|null, delta, reason } — 계좌 잔액 보정(+/−)
// { action: "release-locks", userId }                        — 사용 조회 잠금 해제
// { action: "resolve-hold", holdId, decision: "approve"|"dismiss", note } — 포스 포인트 이전 보류 처리
// { action: "preview-terminal-imports", terminalId } / { action: "reverse-terminal-imports", terminalId, reason } — 포스기의 초기 이전 일괄 되돌리기
export async function POST(req: Request) {
  try {
    await dbConnect();
    const session = await requireOwner();
    const body = await req.json().catch(() => ({}));
    switch (body.action) {
      case "reverse-event":
        return NextResponse.json({ ok: true, ...(await reversePointEvent(String(body.eventId ?? ""), body.reason, session.sub)) });
      case "correct-balance":
        return NextResponse.json({
          ok: true,
          ...(await correctBalance({ userId: String(body.userId ?? ""), companyId: String(body.companyId ?? ""), storeId: body.storeId ? String(body.storeId) : null, delta: body.delta, reason: body.reason, actorId: session.sub })),
        });
      case "release-locks":
        return NextResponse.json({ ok: true, ...(await releaseCustomerLocks(String(body.userId ?? ""), session.sub)) });
      case "resolve-hold": {
        if (body.decision !== "approve" && body.decision !== "dismiss") return NextResponse.json({ error: "INVALID_DECISION" }, { status: 400 });
        return NextResponse.json({ ok: true, ...(await resolveImportHold(String(body.holdId ?? ""), body.decision, body.note, session.sub)) });
      }
      case "preview-terminal-imports":
        return NextResponse.json({ ok: true, ...(await previewTerminalImports(String(body.terminalId ?? ""))) });
      case "reverse-terminal-imports":
        return NextResponse.json({ ok: true, ...(await reverseTerminalImports(String(body.terminalId ?? ""), body.reason, session.sub)) });
      default:
        return NextResponse.json({ error: "INVALID_ACTION" }, { status: 400 });
    }
  } catch (e) {
    return handleApiError(e);
  }
}
