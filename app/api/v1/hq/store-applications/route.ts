import { NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import { requireOwner } from "@/lib/rbac";
import StoreApplication from "@/lib/models/StoreApplication";
import { handleApiError } from "@/lib/api-utils";

// 소유자: 매장 가입 신청 목록 (기본은 대기중만, ?all=1로 전체).
// 신청은 항상 "새 고객사 + 첫 매장"을 만드는 것이라 아직 어느 고객사에도 안 속해서
// 운영자(admin) 범위로는 못 나누고, 소유자만 볼 수 있다.
export async function GET(req: Request) {
  try {
    await dbConnect();
    await requireOwner();
    const all = new URL(req.url).searchParams.get("all") === "1";
    const filter = all ? {} : { status: "PENDING" };
    const applications = await StoreApplication.find(filter)
      .select("-passwordHash")
      .sort({ appliedAt: -1 })
      .lean();
    return NextResponse.json({ applications });
  } catch (e) {
    return handleApiError(e);
  }
}
