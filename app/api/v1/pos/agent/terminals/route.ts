import { NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import PosTerminal from "@/lib/models/PosTerminal";
import { handleApiError, requireAgentTerminal } from "@/lib/api-utils";

const ONLINE_WINDOW_MS = 2 * 60 * 1000; // 2분 이내 하트비트면 "가동중"

// 설치된 포스 프로그램이 "이 매장의 포스기 목록"을 보여주기 위해 호출한다(Bearer apiKey 인증).
// 자기 매장의 단말만 돌려준다.
export async function GET(req: Request) {
  try {
    await dbConnect();
    const { storeId, terminalId } = await requireAgentTerminal(req);

    const terminals = await PosTerminal.find({ storeId, status: "ACTIVE" }).sort({ registeredAt: 1 }).lean();
    const now = Date.now();
    return NextResponse.json({
      terminals: terminals.map((t) => ({
        id: String(t._id),
        name: t.name,
        isPrimary: t.isPrimary === true,
        isSelf: String(t._id) === terminalId,
        online: !!t.lastSeenAt && now - new Date(t.lastSeenAt).getTime() < ONLINE_WINDOW_MS,
      })),
    });
  } catch (e) {
    return handleApiError(e);
  }
}
