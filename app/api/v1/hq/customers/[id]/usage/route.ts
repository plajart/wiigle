import { NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import { requireCompanyAdmin } from "@/lib/rbac";
import PointEvent from "@/lib/models/PointEvent";
import { handleApiError } from "@/lib/api-utils";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await dbConnect();
    await requireCompanyAdmin();
    const { id } = await params;
    const events = await PointEvent.find({ userId: id })
      .sort({ occurredAt: -1 })
      .limit(300)
      .populate("storeId", "name")
      .lean();
    return NextResponse.json({ events });
  } catch (e) {
    return handleApiError(e);
  }
}
