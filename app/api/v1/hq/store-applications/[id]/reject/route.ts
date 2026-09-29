import { NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import { requireOwner } from "@/lib/rbac";
import StoreApplication from "@/lib/models/StoreApplication";
import { handleApiError } from "@/lib/api-utils";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await dbConnect();
    const session = await requireOwner();
    const { id } = await params;
    const { reason } = await req.json().catch(() => ({ reason: undefined }));

    const application = await StoreApplication.findById(id);
    if (!application) return NextResponse.json({ error: "APPLICATION_NOT_FOUND" }, { status: 404 });
    if (application.status !== "PENDING") {
      return NextResponse.json({ error: "APPLICATION_ALREADY_REVIEWED" }, { status: 409 });
    }

    application.status = "REJECTED";
    application.rejectReason = reason;
    application.reviewedBy = session.sub as unknown as typeof application.reviewedBy;
    application.reviewedAt = new Date();
    await application.save();

    return NextResponse.json({ ok: true });
  } catch (e) {
    return handleApiError(e);
  }
}
