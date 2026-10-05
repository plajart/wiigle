import { NextResponse } from "next/server";
import { getAgentBundle, getLauncherPath } from "@/lib/agent-bundle";
import { promises as fs } from "fs";
import { handleApiError, clientIp, rateLimit } from "@/lib/api-utils";

// 포스 프로그램 업데이트 확인 — 프로그램이 서버의 최신 버전(파일 내용 해시)을 물어본다. 비밀 정보 없음.
export async function GET(req: Request) {
  try {
    rateLimit(`agent-version:${clientIp(req)}`, 300, 10 * 60 * 1000);
    const { version, zip } = await getAgentBundle();
    const launcher = await getLauncherPath();
    let launcherVersion: string | null = null;
    if (launcher) {
      const st = await fs.stat(launcher);
      launcherVersion = `${st.size}-${Math.floor(st.mtimeMs / 1000)}`;
    }
    return NextResponse.json({ version, bundleSize: zip.length, launcherVersion });
  } catch (e) {
    return handleApiError(e);
  }
}
