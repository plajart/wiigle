import "server-only";
import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";
import { createZip, type ZipEntry } from "./zip";

// 포스 프로그램 배포물(스크립트들) — 다운로드와 업데이트가 같은 목록을 쓴다.
// 버전은 파일 내용의 해시라서, pos-agent-src 안의 파일이 바뀌면(배포하면) 자동으로 새 버전이 된다(수동 버전 올리기 없음).
export const AGENT_SRC_DIR = path.join(process.cwd(), "pos-agent-src");
export const AGENT_FILES = [
  "point-terminal-agent.ps1",
  "start.bat",
  "uninstall.bat",
  "uninstall.ps1",
  "restore.bat",
  "restore-bulk-import-backup.ps1",
  "pointmanager.ico",
];
export const LAUNCHER_FILE = "PointManager.exe"; // 한 번 빌드해 pos-agent-src에 두는 실행파일(없으면 zip 방식으로 대체)

let cache: { sig: string; version: string; zip: Buffer } | null = null;

export async function getAgentBundle(): Promise<{ version: string; zip: Buffer; entries: ZipEntry[] }> {
  const stats = await Promise.all(AGENT_FILES.map((n) => fs.stat(path.join(AGENT_SRC_DIR, n))));
  const sig = stats.map((s) => `${s.size}:${s.mtimeMs}`).join("|");
  const entries: ZipEntry[] = [];
  for (const name of AGENT_FILES) entries.push({ name, data: await fs.readFile(path.join(AGENT_SRC_DIR, name)) });
  if (cache && cache.sig === sig) return { version: cache.version, zip: cache.zip, entries };
  const h = crypto.createHash("sha256");
  for (const e of entries) {
    h.update(e.name);
    h.update(e.data);
  }
  const version = h.digest("hex").slice(0, 12);
  cache = { sig, version, zip: createZip(entries) };
  return { version, zip: cache.zip, entries };
}

export async function getLauncherPath(): Promise<string | null> {
  const p = path.join(AGENT_SRC_DIR, LAUNCHER_FILE);
  try {
    await fs.access(p);
    return p;
  } catch {
    return null;
  }
}

/** exe 뒤에 붙이는 설치 정보(provision) — [exe][json][json 길이 4바이트 LE]["PMPAYLD1"]. exe가 자기 파일 끝에서 읽는다. */
export function appendPayload(exe: Buffer, payload: object): Buffer {
  const json = Buffer.from(JSON.stringify(payload), "utf8");
  const len = Buffer.alloc(4);
  len.writeUInt32LE(json.length, 0);
  return Buffer.concat([exe, json, len, Buffer.from("PMPAYLD1", "ascii")]);
}
