import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/rbac";
import { getOpsReview } from "@/lib/ops-review";
import { handleApiError } from "@/lib/api-utils";

// 본사: 운영 점검 — 포스기 상태, 확인이 필요한 항목(이전 보류·마이너스 잔액·잔액 부족 차감·서버 거부/보류·오래 남은 반영·잠금), 기간 내 내역 요약.
// ?companyId=…&storeId=…&hours=24 (없으면 전체)
export async function GET(req: Request) {
  try {
    await requireOwner();
    const url = new URL(req.url);
    const companyId = url.searchParams.get("companyId") || undefined;
    const storeId = url.searchParams.get("storeId") || undefined;
    const hours = Number(url.searchParams.get("hours")) || 24;
    return NextResponse.json(await getOpsReview({ companyId, storeId, hours }));
  } catch (e) {
    return handleApiError(e);
  }
}
