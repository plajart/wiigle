import { NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import PosTerminal from "@/lib/models/PosTerminal";
import Store from "@/lib/models/Store";
import Company from "@/lib/models/Company";
import { getAgentBundle } from "@/lib/agent-bundle";
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
    // 진단 정보(선택) — 본문이 없거나 깨져 있어도 하트비트 자체는 항상 성공시킨다.
    const body = await req.json().catch(() => null);
    if (body && typeof body === "object") {
      const n = (v: unknown) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Math.floor(Number(v)) : 0);
      const lastErrorAt = body.lastErrorAt ? new Date(String(body.lastErrorAt)) : null;
      terminal.agentStatus = {
        pending: n(body.pending),
        skippedNoPhone: n(body.skippedNoPhone),
        lastError: body.lastError ? String(body.lastError).slice(0, 300) : null,
        lastErrorAt: lastErrorAt && !isNaN(lastErrorAt.getTime()) ? lastErrorAt : null,
        reportedAt: new Date(),
      };
      terminal.markModified("agentStatus");
    }
    await terminal.save();

    // isPrimary를 하트비트 응답에 실어보내 에이전트가 매번 최신 상태로 관리모드
    // 바로가기(대표 포스기만)를 만들거나 지울 수 있게 한다.
    // 포스기가 다른 매장으로 옮겨졌을 때(고객사 운영자·본사가 이동) 화면 표시를 최신으로 맞추고, 새 버전이 있으면 알려준다.
    const store = await Store.findById(terminal.storeId).select("name companyId").lean();
    const company = store ? await Company.findById(store.companyId).select("name").lean() : null;
    let agentVersion: string | null = null;
    try {
      agentVersion = (await getAgentBundle()).version;
    } catch {
      // 버전 확인 실패는 하트비트를 막지 않는다
    }
    return NextResponse.json({ ok: true, terminalName: terminal.name, storeId: String(terminal.storeId), storeName: store?.name ?? null, companyName: company?.name ?? null, agentVersion, isPrimary: terminal.isPrimary === true, storeUrl: `${process.env.APP_BASE_URL || "https://concrab.com"}/store` });
  } catch (e) {
    return handleApiError(e);
  }
}
