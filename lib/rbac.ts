import "server-only";
import { getFreshSession } from "./session";
import type { SessionPayload } from "./auth";
import Store from "./models/Store";
import { resolveStoreId } from "./store-context";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function requireSession(): Promise<SessionPayload> {
  const session = await getFreshSession();
  if (!session) throw new ApiError(401, "UNAUTHENTICATED");
  return session;
}

// 소유자(플랫폼) 권한 필요 — 슈퍼유저, 모든 고객사·매장을 넘나든다.
export async function requireOwner(): Promise<SessionPayload> {
  const session = await requireSession();
  if (session.role !== "owner") throw new ApiError(403, "FORBIDDEN");
  return session;
}

// 운영자(고객사) 권한 필요(아무 고객사나) — 소유자도 통과(상위 등급).
// 고객사 목록 조회처럼 소유자가 넘겨봐도 되는 화면에 쓴다.
export async function requireCompanyAdmin(): Promise<SessionPayload> {
  const session = await requireSession();
  if (session.role !== "owner" && session.role !== "admin") throw new ApiError(403, "FORBIDDEN");
  return session;
}

// 본인이 실제로 관리하는 "내 고객사"가 있어야 하는 동작에 쓴다.
// 소유자라도 자기 고객사가 따로 없으면 통과 못함 — 항상 특정 고객사 맥락이 필요하기 때문.
export async function requireOwnCompany(): Promise<SessionPayload & { companyAdminOf: string }> {
  const session = await requireSession();
  if (!session.companyAdminOf) throw new ApiError(403, "NO_COMPANY_CONTEXT");
  return session as SessionPayload & { companyAdminOf: string };
}

// 관리자(매장) 권한 필요(아무 매장이나) — 운영자·소유자도 통과(상위 등급).
// 매장 대시보드 조회처럼 상위 등급이 넘겨봐도 되는 화면에 쓴다.
export async function requireStoreManager(): Promise<SessionPayload> {
  const session = await requireSession();
  if (session.role !== "owner" && session.role !== "admin" && session.role !== "manager") {
    throw new ApiError(403, "FORBIDDEN");
  }
  return session;
}

// 본인이 실제로 관리하는 "내 매장"이 있어야 하는 동작(POS 터미널 결제/조회 등)에 쓴다.
// - manager: 자기 매장.
// - owner(소유자): 슈퍼관리자라서 매장 관리자 권한을 모두 갖는다 — 매장 관리모드로 들어가 있는
//   매장(쿠키, 권한은 매번 재검증)을 "내 매장"으로 본다. 매장에 들어가 있지 않으면 통과 못함.
// - admin(운영자): 결제 같은 매장 운영 동작은 하지 않는다(설정·조회는 매장 관리모드에서 가능).
export async function requireOwnStore(): Promise<SessionPayload & { storeManagerOf: string }> {
  const session = await requireSession();
  if (session.role === "owner") {
    const storeId = await resolveStoreId(session);
    if (!storeId) throw new ApiError(403, "NO_STORE_CONTEXT");
    return { ...session, storeManagerOf: storeId };
  }
  if (!session.storeManagerOf) throw new ApiError(403, "NO_STORE_CONTEXT");
  return session as SessionPayload & { storeManagerOf: string };
}

// 고객사 범위 검사: 소유자는 전체 통과, 운영자는 자기 고객사만.
export function assertCompanyScope(session: SessionPayload, companyId: string) {
  if (session.role === "owner") return;
  if (session.role === "admin" && session.companyAdminOf === companyId) return;
  throw new ApiError(403, "FORBIDDEN_COMPANY_SCOPE");
}

// 매장 범위 검사: 소유자는 전체 통과, 관리자는 자기 매장만, 운영자는 자기 고객사 소속 매장만
// (매장의 companyId 조회가 필요해 비동기).
export async function assertStoreScope(session: SessionPayload, storeId: string) {
  if (session.role === "owner") return;
  if (session.role === "manager") {
    if (session.storeManagerOf === storeId) return;
    throw new ApiError(403, "FORBIDDEN_STORE_SCOPE");
  }
  if (session.role === "admin") {
    const store = await Store.findById(storeId).select("companyId").lean();
    if (store && String(store.companyId) === session.companyAdminOf) return;
    throw new ApiError(403, "FORBIDDEN_STORE_SCOPE");
  }
  throw new ApiError(403, "FORBIDDEN_STORE_SCOPE");
}
