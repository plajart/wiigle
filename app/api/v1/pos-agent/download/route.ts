import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";
import { dbConnect } from "@/lib/mongodb";
import { requireStoreManager, ApiError } from "@/lib/rbac";
import { resolveStoreId } from "@/lib/store-context";
import PosProvisionToken, { hashProvisionToken } from "@/lib/models/PosProvisionToken";
import Store from "@/lib/models/Store";
import { handleApiError } from "@/lib/api-utils";
import { createZip, type ZipEntry } from "@/lib/zip";

const AGENT_SRC_DIR = path.join(process.cwd(), "pos-agent-src");
const AGENT_FILES = ["point-terminal-agent.ps1", "start.bat", "restore-bulk-import-backup.ps1", "pointmanager.ico"];

// 매장 포스 프로그램 다운로드 — 로그인한 매장 관리자(또는 ?storeId=로 들어온 운영자·소유자)만.
// 요청할 때마다 이 매장 전용 1회용 설치 토큰을 새로 만들어 설정파일(provision.json)에 내장한
// 압축파일을 즉석에서 만든다. 카운터PC에서 압축을 풀고 start.bat만 실행하면 인증코드 입력 없이
// 설치·등록이 끝난다. 이 압축파일은 그 매장의 등록 권한을 담고 있으므로 남에게 전달하지 말 것.
export async function GET(req: Request) {
  try {
    await dbConnect();
    const session = await requireStoreManager();
    const queryStoreId = new URL(req.url).searchParams.get("storeId") ?? undefined;
    const storeId = await resolveStoreId(session, queryStoreId);
    if (!storeId) throw new ApiError(400, "STORE_REQUIRED");

    const store = await Store.findById(storeId).select("name").lean();
    if (!store) throw new ApiError(404, "STORE_NOT_FOUND");

    const token = crypto.randomBytes(32).toString("hex");
    await PosProvisionToken.create({ tokenHash: hashProvisionToken(token), storeId, issuedBy: session.sub });

    const entries: ZipEntry[] = [];
    for (const name of AGENT_FILES) {
      entries.push({ name, data: await fs.readFile(path.join(AGENT_SRC_DIR, name)) });
    }
    const baseUrl = process.env.APP_BASE_URL || new URL(req.url).origin;
    const provision = { baseUrl, token, storeName: store.name };
    // 앞의 BOM은 Windows PowerShell 5.1이 UTF-8(한글 매장명)로 읽게 하기 위한 것
    entries.push({ name: "provision.json", data: Buffer.from("﻿" + JSON.stringify(provision, null, 2), "utf8") });

    return new NextResponse(new Uint8Array(createZip(entries)), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="point-terminal-agent.zip"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return handleApiError(e);
  }
}
