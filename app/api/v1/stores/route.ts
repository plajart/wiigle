import { NextResponse } from "next/server";
import crypto from "crypto";
import { dbConnect } from "@/lib/mongodb";
import { requireCompanyAdmin } from "@/lib/rbac";
import { hashPassword } from "@/lib/auth";
import { issueDigitalCardNo } from "@/lib/card";
import Store from "@/lib/models/Store";
import Company from "@/lib/models/Company";
import User from "@/lib/models/User";
import AuditLog from "@/lib/models/AuditLog";
import { handleApiError } from "@/lib/api-utils";

// 운영자: 자기 고객사의 매장 목록 / 소유자: 전체(또는 ?companyId= 로 한 고객사만).
// 예전엔 로그인한 누구에게나 모든 고객사의 매장이 나갔다 — 고객사별로 나눈 뒤로는 범위를 제한한다.
export async function GET(req: Request) {
  try {
    await dbConnect();
    const session = await requireCompanyAdmin();
    const queryCompanyId = new URL(req.url).searchParams.get("companyId");

    let filter: Record<string, unknown> = {};
    if (session.role === "admin") {
      filter = { companyId: session.companyAdminOf };
    } else if (queryCompanyId) {
      filter = { companyId: queryCompanyId };
    }
    const [stores, companies] = await Promise.all([
      Store.find(filter).select("name franchiseCode companyId").sort({ name: 1 }).lean(),
      Company.find().select("name").lean(),
    ]);
    const nameOf = new Map(companies.map((c) => [String(c._id), c.name]));
    return NextResponse.json({
      stores: stores.map((s) => ({
        _id: String(s._id),
        name: s.name,
        franchiseCode: s.franchiseCode,
        companyId: String(s.companyId),
        companyName: nameOf.get(String(s.companyId)) ?? "(고객사 없음)",
      })),
    });
  } catch (e) {
    return handleApiError(e);
  }
}

// 운영자(또는 소유자): 매장 생성. 매장 관리자(manager) 계정도 함께 생성(초대 발송 인프라가
// 없어 임시 비밀번호를 응답으로 직접 반환하는 방식으로 단순화 — 운영 전 이메일/SMS 초대로
// 교체 권장). 운영자는 자기 고객사에만 만들 수 있고, 소유자는 companyId를 지정해야 한다.
export async function POST(req: Request) {
  try {
    await dbConnect();
    const session = await requireCompanyAdmin();
    const { name, franchiseCode, adminPhone, adminName, companyId } = await req.json();
    if (!name || !adminPhone || !adminName) {
      return NextResponse.json({ error: "MISSING_FIELDS" }, { status: 400 });
    }

    let targetCompanyId: string;
    if (session.role === "admin") {
      targetCompanyId = session.companyAdminOf!;
    } else {
      if (!companyId) return NextResponse.json({ error: "COMPANY_ID_REQUIRED" }, { status: 400 });
      targetCompanyId = companyId;
    }

    const dup = await User.findOne({ phone: adminPhone });
    if (dup) return NextResponse.json({ error: "PHONE_ALREADY_USED" }, { status: 409 });

    const store = await Store.create({ name, companyId: targetCompanyId, franchiseCode, posIntegration: { scopes: [] } });

    const tempPassword = crypto.randomBytes(9).toString("base64url"); // 추측 방지(2026-09-29)
    const passwordHash = await hashPassword(tempPassword);
    const digitalCardNo = await issueDigitalCardNo();
    const manager = await User.create({
      phone: adminPhone,
      name: adminName,
      passwordHash,
      role: "manager",
      storeManagerOf: store._id,
      phoneVerified: true,
      digitalCardNo,
    });

    await AuditLog.create({
      storeId: store._id,
      actorType: "HQ_ADMIN",
      actorId: session.sub,
      action: "STORE_CREATE",
      meta: { storeId: store._id, managerId: manager._id },
    });

    return NextResponse.json({ ok: true, store, storeManager: { phone: adminPhone, tempPassword } });
  } catch (e) {
    return handleApiError(e);
  }
}
