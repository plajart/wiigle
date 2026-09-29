import { NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import { bulkImportLegacyBalances, type BulkImportEntry } from "@/lib/points";
import { handleApiError, requireAgentTerminal } from "@/lib/api-utils";

const MAX_ENTRIES_PER_CALL = 500;

// 포스기 한 대가 설치·등록될 때 한 번 호출 — 그 포스기의 로컬 DB에 전화번호가 있는
// 기존 회원 전원의 잔액을 서버로 이전한다. 포스기 단위 멱등(claimVendorImport)이라
// 영업 중에 매장의 포스기를 한 대씩 순서대로 초기화해도, 다른 포스기가 이미 실적립
// 중이어도 안전하다 — 대표 포스기 여부와 무관하게 모든 등록된 포스기가 호출 가능.
export async function POST(req: Request) {
  try {
    await dbConnect();
    const { storeId, terminalId } = await requireAgentTerminal(req);

    const body = await req.json();
    const entries: BulkImportEntry[] = Array.isArray(body.entries) ? body.entries : [];
    if (entries.length === 0) return NextResponse.json({ error: "ENTRIES_REQUIRED" }, { status: 400 });
    if (entries.length > MAX_ENTRIES_PER_CALL) {
      return NextResponse.json({ error: "TOO_MANY_ENTRIES_PER_CALL", max: MAX_ENTRIES_PER_CALL }, { status: 400 });
    }

    const result = await bulkImportLegacyBalances(storeId, terminalId, entries);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return handleApiError(e);
  }
}
