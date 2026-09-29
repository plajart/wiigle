import { NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import PosTerminal from "@/lib/models/PosTerminal";
import { handleApiError } from "@/lib/api-utils";

// POS 단말 프로그램이 주기적으로(예: 1분마다) 호출 — "지금 이 순간 살아있다"는 신호.
// 인증: Authorization: Bearer <apiKey> (register 시 발급받은 값)
export async function POST(req: Request) {
  try {
    await dbConnect();
    const auth = req.headers.get("authorization") ?? "";
    const apiKey = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (!apiKey) return NextResponse.json({ error: "API_KEY_REQUIRED" }, { status: 401 });

    const terminal = await PosTerminal.findOne({ apiKey });
    if (!terminal) return NextResponse.json({ error: "INVALID_API_KEY" }, { status: 401 });
    if (terminal.status !== "ACTIVE") return NextResponse.json({ error: "TERMINAL_REVOKED" }, { status: 403 });

    terminal.lastSeenAt = new Date();
    await terminal.save();

    // isPrimary를 하트비트 응답에 실어보내 에이전트가 매번 최신 상태로 관리모드
    // 바로가기(대표 포스기만)를 만들거나 지울 수 있게 한다.
    return NextResponse.json({ ok: true, isPrimary: terminal.isPrimary === true, storeUrl: `${process.env.APP_BASE_URL || "https://concrab.com"}/store` });
  } catch (e) {
    return handleApiError(e);
  }
}
