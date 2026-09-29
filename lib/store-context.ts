import "server-only";
import type { SessionPayload } from "./auth";
import { ApiError } from "./rbac";
import Store from "./models/Store";

/**
 * "지금 이 세션이 보고 있는 매장이 어디인지" 결정한다.
 * - manager: 자기 매장(storeManagerOf) 고정.
 * - owner/admin: ?storeId= 쿼리로 넘겨준 매장(소유자 모드/운영자 모드에서 "관리모드로 들어가기"
 *   눌렀을 때 붙는 파라미터) — admin은 그 매장이 자기 고객사 소속인지 확인한다.
 * 셋 다 아니면 null(호출 쪽에서 로그인/매장선택 화면으로 보내면 됨).
 */
export async function resolveStoreId(session: SessionPayload, queryStoreId?: string): Promise<string | null> {
  if (session.role === "manager") return session.storeManagerOf ?? null;
  if (session.role === "owner") return queryStoreId ?? null;
  if (session.role === "admin") {
    if (!queryStoreId) return null;
    const store = await Store.findById(queryStoreId).select("companyId").lean();
    if (!store || String(store.companyId) !== session.companyAdminOf) {
      throw new ApiError(403, "FORBIDDEN_STORE_SCOPE");
    }
    return queryStoreId;
  }
  return null;
}
