import { NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import { requireSession, assertStoreScope } from "@/lib/rbac";
import PointAccount from "@/lib/models/PointAccount";
import { handleApiError } from "@/lib/api-utils";

export async function GET(_req: Request, { params }: { params: Promise<{ storeId: string }> }) {
  try {
    await dbConnect();
    const { storeId } = await params;
    const session = await requireSession();
    await assertStoreScope(session, storeId);

    const accounts = await PointAccount.find({ storeId, type: "STORE" }).lean();
    const totalBalance = accounts.reduce((s, a) => s + a.balance, 0);
    return NextResponse.json({ storeId, customerCount: accounts.length, totalBalance });
  } catch (e) {
    return handleApiError(e);
  }
}
