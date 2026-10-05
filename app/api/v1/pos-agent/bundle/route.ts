import { NextResponse } from "next/server";
import { getAgentBundle } from "@/lib/agent-bundle";
import { handleApiError, clientIp, rateLimit } from "@/lib/api-utils";

// 포스 프로그램 최신 스크립트 묶음(zip) — 설치·업데이트용. 매장 정보·인증 정보는 들어 있지 않다(설치 정보는 따로 받는다).
export async function GET(req: Request) {
  try {
    rateLimit(`agent-bundle:${clientIp(req)}`, 60, 10 * 60 * 1000);
    const { version, zip } = await getAgentBundle();
    return new NextResponse(new Uint8Array(zip), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="point-terminal-agent-${version}.zip"`,
        "X-Agent-Version": version,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return handleApiError(e);
  }
}
