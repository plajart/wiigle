import "server-only";
import { cookies } from "next/headers";
import mongoose from "mongoose";
import type { SessionPayload } from "./auth";
import { dbConnect } from "./mongodb";
import Store from "./models/Store";

// 본사·고객사 운영자가 "매장 관리모드"로 들어가 있는 동안 현재 매장을 기억하는 쿠키.
// /store/enter?storeId= 를 거치면 설정된다. 값은 신뢰하지 않고 매 요청마다 권한을 다시 확인한다.
export const STORE_CONTEXT_COOKIE = "pm_store";

/**
 * "지금 이 세션이 보고 있는 매장이 어디인지" 결정한다.
 * - manager: 자기 매장(storeManagerOf) 고정.
 * - owner/admin: 매장 관리모드 진입 시 저장된 쿠키의 매장(쿠키가 없을 때만 ?storeId= 를 대체로 인정).
 *   admin은 그 매장이 자기 고객사 소속일 때만 인정하고, 아니면(쿠키가 낡았거나 조작됨) null.
 * 결정할 수 없으면 null(호출 쪽에서 매장 선택 화면/홈으로 보내면 됨).
 */
export async function resolveStoreId(session: SessionPayload, queryStoreId?: string): Promise<string | null> {
  if (session.role === "manager") return session.storeManagerOf ?? null;
  if (session.role !== "owner" && session.role !== "admin") return null;

  const cookieStore = await cookies();
  const candidate = cookieStore.get(STORE_CONTEXT_COOKIE)?.value ?? queryStoreId;
  if (!candidate || !mongoose.isValidObjectId(candidate)) return null;

  await dbConnect();
  const store = await Store.findById(candidate).select("companyId").lean();
  if (!store) return null;
  if (session.role === "admin" && String(store.companyId) !== session.companyAdminOf) return null;
  return candidate;
}
