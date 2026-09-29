import { NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import { requireCompanyAdmin, ApiError } from "@/lib/rbac";
import { assignManager } from "@/lib/account-assign";
import { resolveCompanyId } from "@/lib/company-context";
import Store from "@/lib/models/Store";
import Company from "@/lib/models/Company";
import AuditLog from "@/lib/models/AuditLog";
import { handleApiError } from "@/lib/api-utils";

// 운영자: 자기 고객사의 매장 목록 / 소유자: 전체(또는 ?companyId= 로 한 고객사만).
// 예전엔 로그인한 누구에게나 모든 고객사의 매장이 나갔다 — 고객사별로 나눈 뒤로는 범위를 제한한다.
export async function GET(req: Request) {
  try {
    await dbConnect();
    const session = await requireCompanyAdmin();
    const queryCompanyId = new URL(req.url).searchParams.get("companyId");

    // 운영자는 자기 고객사, 소유자는 ?companyId= → 본사 관리모드로 들어간 고객사 → (없으면) 전체 순.
    let filter: Record<string, unknown> = {};
    if (session.role === "admin") {
      filter = { companyId: session.companyAdminOf };
    } else {
      const companyId = queryCompanyId ?? (await resolveCompanyId(session));
      if (companyId) filter = { companyId };
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

// 운영자(또는 소유자): 매장 생성. 매장 관리자는 선택이다 — 계정 없이 매장 정보만 만들어 두고 나중에
// `/api/v1/stores/[storeId]/managers`로 지정해도 된다. adminPhone을 함께 보내면 그 사람을 관리자로 지정한다
// (가입 안 한 번호면 adminName으로 계정을 새로 만들고 임시 비밀번호를 응답으로 한 번만 돌려준다).
// 운영자는 자기 고객사에만 만들 수 있고, 소유자는 본사 관리모드로 들어간 고객사(또는 companyId)에 만든다.
export async function POST(req: Request) {
  try {
    await dbConnect();
    const session = await requireCompanyAdmin();
    const { name, franchiseCode, adminPhone, adminName, companyId } = await req.json();
    if (!name) return NextResponse.json({ error: "MISSING_FIELDS" }, { status: 400 });

    let targetCompanyId: string;
    if (session.role === "admin") {
      targetCompanyId = session.companyAdminOf!;
    } else {
      const chosen = companyId ?? (await resolveCompanyId(session));
      if (!chosen) return NextResponse.json({ error: "COMPANY_ID_REQUIRED" }, { status: 400 });
      targetCompanyId = chosen;
    }

    const store = await Store.create({ name, companyId: targetCompanyId, franchiseCode, posIntegration: { scopes: [] } });
    await AuditLog.create({
      storeId: store._id,
      actorType: "HQ_ADMIN",
      actorId: session.sub,
      action: "STORE_CREATE",
      meta: { storeId: store._id },
    });

    // 관리자 지정은 매장이 만들어진 뒤에 한다 — 실패해도 매장은 남고, 관리자는 나중에 다시 지정하면 된다.
    let manager: Awaited<ReturnType<typeof assignManager>> | null = null;
    let managerError: string | null = null;
    if (adminPhone) {
      try {
        manager = await assignManager(String(store._id), adminPhone, adminName);
        await AuditLog.create({
          storeId: store._id,
          actorType: "HQ_ADMIN",
          actorId: session.sub,
          action: "MANAGER_ASSIGN",
          meta: { userId: manager.userId, created: manager.created },
        });
      } catch (e) {
        managerError = e instanceof ApiError ? e.message : "ASSIGN_FAILED";
      }
    }

    return NextResponse.json({ ok: true, store, storeManager: manager, managerError });
  } catch (e) {
    return handleApiError(e);
  }
}
