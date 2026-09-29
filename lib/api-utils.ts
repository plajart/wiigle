import { NextResponse } from "next/server";
import { ApiError } from "./rbac";
import PosTerminal, { type IPosTerminal } from "./models/PosTerminal";
import Store, { type IStore } from "./models/Store";
import type { HydratedDocument } from "mongoose";

export function handleApiError(e: unknown) {
  if (e instanceof ApiError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  console.error(e);
  return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
}

/**
 * 아주 단순한 메모리 기반 IP 요청빈도 제한 — 등록코드(6자리, 100만 가지)처럼 짧은 유효기간
 * 안에 무차별 대입이 가능한 엔드포인트를 지킨다. 배포가 단일 파드라 메모리 기반으로 충분하다
 * (2026-09-29, 실매장 적용 전 보안점검). 재시작하면 초기화되는 정도는 감수.
 */
const rateLimitBuckets = new Map<string, { count: number; resetAt: number }>();

export function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

/** key별로 windowMs 동안 max회까지만 허용. 초과 시 429 던짐. */
export function rateLimit(key: string, max: number, windowMs: number) {
  const now = Date.now();
  const bucket = rateLimitBuckets.get(key);
  if (!bucket || bucket.resetAt < now) {
    rateLimitBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }
  bucket.count++;
  if (bucket.count > max) throw new ApiError(429, "TOO_MANY_REQUESTS");
}

/**
 * POS 에이전트 인증(Authorization: Bearer <apiKey>) — vendor-sync/agent/earn/redeem 라우트가
 * 공통으로 쓰는 검증. 성공하면 terminal·store를 돌려주고 lastSeenAt(하트비트)도 같이 갱신한다.
 */
export async function requireAgentTerminal(
  req: Request
): Promise<{ terminal: HydratedDocument<IPosTerminal>; store: HydratedDocument<IStore>; storeId: string; terminalId: string }> {
  const auth = req.headers.get("authorization") ?? "";
  const apiKey = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!apiKey) throw new ApiError(401, "API_KEY_REQUIRED");

  const terminal = await PosTerminal.findOne({ apiKey });
  if (!terminal) throw new ApiError(401, "INVALID_API_KEY");
  if (terminal.status !== "ACTIVE") throw new ApiError(403, "TERMINAL_REVOKED");

  const store = await Store.findById(terminal.storeId);
  if (!store) throw new ApiError(404, "STORE_NOT_FOUND");

  terminal.lastSeenAt = new Date();
  await terminal.save();

  return { terminal, store, storeId: String(terminal.storeId), terminalId: String(terminal._id) };
}
