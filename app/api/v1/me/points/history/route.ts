import { NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import { requireSession } from "@/lib/rbac";
import { getMyPointHistory } from "@/lib/points";
import { handleApiError } from "@/lib/api-utils";

export async function GET() {
  try {
    await dbConnect();
    const session = await requireSession();
    const history = await getMyPointHistory(session.sub, undefined, { onlyOpen: true });
    return NextResponse.json({ history });
  } catch (e) {
    return handleApiError(e);
  }
}
