import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { requireStoreAdmin } from "@/lib/rbac";
import { handleApiError } from "@/lib/api-utils";

const AGENT_ZIP_PATH = path.join(process.cwd(), "uploads", "pos-agent", "point-terminal-agent.zip");

// 매장 POS 프로그램 다운로드 — 본사·매장 관리자만(로그인 필요). 고객에게는 절대 노출되면 안 됨
// (설치 자체는 등록코드 없이는 무의미하지만, 내부 구조·에이전트 코드를 불필요하게 외부에
// 노출하지 않기 위해 접근을 막는다).
export async function GET() {
  try {
    await requireStoreAdmin();
    const buf = await fs.readFile(AGENT_ZIP_PATH);
    return new NextResponse(buf, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="point-terminal-agent.zip"`,
      },
    });
  } catch (e) {
    return handleApiError(e);
  }
}
