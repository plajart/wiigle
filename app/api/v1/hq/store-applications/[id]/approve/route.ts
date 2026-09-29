import { NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import { requireOwner } from "@/lib/rbac";
import Company from "@/lib/models/Company";
import Store from "@/lib/models/Store";
import User from "@/lib/models/User";
import AuditLog from "@/lib/models/AuditLog";
import StoreApplication from "@/lib/models/StoreApplication";
import { issueDigitalCardNo } from "@/lib/card";
import { handleApiError } from "@/lib/api-utils";

// 소유자: 매장 가입 신청 승인 → 새 고객사 + 첫 매장 + 매장 관리자(manager) 계정 생성.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await dbConnect();
    const session = await requireOwner();
    const { id } = await params;

    const application = await StoreApplication.findById(id);
    if (!application) return NextResponse.json({ error: "APPLICATION_NOT_FOUND" }, { status: 404 });
    if (application.status !== "PENDING") {
      return NextResponse.json({ error: "APPLICATION_ALREADY_REVIEWED" }, { status: 409 });
    }

    const dup = await User.findOne({ phone: application.applicantPhone });
    if (dup) return NextResponse.json({ error: "PHONE_ALREADY_USED" }, { status: 409 });

    const company = await Company.create({ name: application.companyName });

    const store = await Store.create({
      name: application.storeName,
      companyId: company._id,
      franchiseCode: application.franchiseCode,
      posIntegration: { scopes: [] },
    });

    const digitalCardNo = await issueDigitalCardNo();
    const manager = await User.create({
      phone: application.applicantPhone,
      name: application.applicantName,
      passwordHash: application.passwordHash, // 신청 시 본인이 설정한 비밀번호 그대로 사용
      role: "manager",
      storeManagerOf: store._id,
      phoneVerified: true,
      digitalCardNo,
    });

    application.status = "APPROVED";
    application.reviewedBy = session.sub as unknown as typeof application.reviewedBy;
    application.reviewedAt = new Date();
    application.createdCompanyId = company._id;
    application.createdStoreId = store._id;
    application.createdUserId = manager._id;
    await application.save();

    await AuditLog.create({
      storeId: store._id,
      actorType: "HQ_ADMIN",
      actorId: session.sub,
      action: "STORE_APPLICATION_APPROVED",
      meta: { applicationId: application._id, companyId: company._id, storeId: store._id, managerId: manager._id },
    });

    return NextResponse.json({ ok: true, companyId: company._id, storeId: store._id });
  } catch (e) {
    return handleApiError(e);
  }
}
