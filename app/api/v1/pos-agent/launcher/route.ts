import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import { getLauncherPath } from "@/lib/agent-bundle";
import { handleApiError, clientIp, rateLimit } from "@/lib/api-utils";

// 실행파일(PointManager.exe) 자체 업데이트용 — 설치 정보는 들어 있지 않은 순수 실행파일.
export async function GET(req: Request) {
  try {
    rateLimit(`agent-launcher:${clientIp(req)}`, 30, 10 * 60 * 1000);
    const p = await getLauncherPath();
    if (!p) return NextResponse.json({ error: "LAUNCHER_NOT_AVAILABLE" }, { status: 404 });
    const data = await fs.readFile(p);
    return new NextResponse(new Uint8Array(data), {
      headers: { "Content-Type": "application/octet-stream", "Content-Disposition": `attachment; filename="PointManager.exe"`, "Cache-Control": "no-store" },
    });
  } catch (e) {
    return handleApiError(e);
  }
}
