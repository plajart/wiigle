import { NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import { requireOwner } from "@/lib/rbac";
import Company from "@/lib/models/Company";
import Store, { DEFAULT_POS_SCOPES } from "@/lib/models/Store";
import User from "@/lib/models/User";
import AuditLog from "@/lib/models/AuditLog";
import StoreApplication from "@/lib/models/StoreApplication";
import { issueDigitalCardNo } from "@/lib/card";
import { handleApiError } from "@/lib/api-utils";

// 소유자: 등록 신청 승인 → (새 고객사 또는 기존 고객사에) 매장 + 매장 관리자(manager) 계정 생성.
//  - body.companyId 가 있으면 그 기존 고객사에 매장을 추가한다.
//  - 없으면 새 고객사를 만든다. 단 같은 이름의 고객사가 이미 있으면 중복 생성을 막고 409(COMPANY_NAME_EXISTS)로
//    알려서 소유자가 "기존 고객사에 추가"를 고르게 한다.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await dbConnect();
    const session = await requireOwner();
    const { id } = await params;
    const { companyId } = await req.json().catch(() => ({ companyId: undefined }));

    const application = await StoreApplication.findById(id);
    if (!application) return NextResponse.json({ error: "APPLICATION_NOT_FOUND" }, { status: 404 });
    if (application.status !== "PENDING") {
      return NextResponse.json({ error: "APPLICATION_ALREADY_REVIEWED" }, { status: 409 });
    }

    const dup = await User.findOne({ phone: application.applicantPhone });
    if (dup) return NextResponse.json({ error: "PHONE_ALREADY_USED" }, { status: 409 });

    let company;
    if (companyId) {
      company = await Company.findById(companyId);
      if (!company) return NextResponse.json({ error: "COMPANY_NOT_FOUND" }, { status: 404 });
      // 기존 고객사에 붙일 때 같은 이름의 매장이 이미 있으면 막는다(고객사 안에서 매장 이름은 중복 불가)
      if (await Store.exists({ companyId: company._id, name: application.storeName })) {
        return NextResponse.json({ error: "STORE_NAME_IN_USE" }, { status: 409 });
      }
    } else {
      const same = await Company.findOne({ name: application.companyName }).select("_id").lean();
      if (same) return NextResponse.json({ error: "COMPANY_NAME_EXISTS", existingCompanyId: String(same._id) }, { status: 409 });
      company = await Company.create({ name: application.companyName });
    }

    const store = await Store.create({
      name: application.storeName,
      companyId: company._id,
      franchiseCode: application.franchiseCode,
      posIntegration: { scopes: [...DEFAULT_POS_SCOPES] },
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
      meta: { applicationId: application._id, companyId: company._id, storeId: store._id, managerId: manager._id, newCompany: !companyId },
    });

    return NextResponse.json({ ok: true, companyId: company._id, storeId: store._id });
  } catch (e) {
    return handleApiError(e);
  }
}
