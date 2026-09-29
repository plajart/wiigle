import { NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import { requireSession } from "@/lib/rbac";
import { getMyPointSummary } from "@/lib/points";
import { handleApiError } from "@/lib/api-utils";

// 회원이면 누구나(본사·고객사 운영자·매장 관리자 포함) 본인의 포인트를 조회할 수 있다.
export async function GET() {
  try {
    await dbConnect();
    const session = await requireSession();
    const summary = await getMyPointSummary(session.sub);
    return NextResponse.json(summary);
  } catch (e) {
    return handleApiError(e);
  }
}
