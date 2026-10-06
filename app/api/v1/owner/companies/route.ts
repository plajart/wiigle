import { NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import { requireOwner } from "@/lib/rbac";
import Company from "@/lib/models/Company";
import Store from "@/lib/models/Store";
import User from "@/lib/models/User";
import { handleApiError } from "@/lib/api-utils";
import { cleanName, assertCompanyNameFree, duplicateAs } from "@/lib/name-check";

// 소유자: 고객사 목록(소속 매장 수·배정된 운영자 수 포함).
export async function GET() {
  try {
    await dbConnect();
    await requireOwner();
    const [companies, storeCounts, adminCounts] = await Promise.all([
      Company.find().sort({ createdAt: 1 }).lean(),
      Store.aggregate([{ $group: { _id: "$companyId", n: { $sum: 1 } } }]),
      User.aggregate([{ $match: { role: "admin" } }, { $group: { _id: "$companyAdminOf", n: { $sum: 1 } } }]),
    ]);
    const storesBy = new Map(storeCounts.map((r) => [String(r._id), r.n as number]));
    const adminsBy = new Map(adminCounts.map((r) => [String(r._id), r.n as number]));
    return NextResponse.json({
      companies: companies.map((c) => ({
        _id: String(c._id),
        name: c.name,
        createdAt: c.createdAt,
        customerWebEnabled: c.customerWebEnabled !== false,
        storeCount: storesBy.get(String(c._id)) ?? 0,
        adminCount: adminsBy.get(String(c._id)) ?? 0,
      })),
    });
  } catch (e) {
    return handleApiError(e);
  }
}

// 소유자: 고객사 생성.
export async function POST(req: Request) {
  try {
    await dbConnect();
    await requireOwner();
    const { name } = await req.json();
    const trimmed = cleanName(name);
    if (!trimmed) return NextResponse.json({ error: "NAME_REQUIRED" }, { status: 400 });
    await assertCompanyNameFree(trimmed);
    const company = await Company.create({ name: trimmed }).catch((e) => duplicateAs(e, "COMPANY_NAME_IN_USE"));
    return NextResponse.json({ ok: true, company: { _id: String(company._id), name: company.name } });
  } catch (e) {
    return handleApiError(e);
  }
}
