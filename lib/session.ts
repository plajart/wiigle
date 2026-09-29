import "server-only";
import { cookies } from "next/headers";
import { SESSION_COOKIE, SessionPayload, verifySession } from "./auth";
import { dbConnect } from "./mongodb";
import User from "./models/User";

export async function getSession(): Promise<SessionPayload | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifySession(token);
}

/**
 * 세션(JWT)에 든 역할은 최대 7일 동안 그대로라서, 고객사 운영자·매장 관리자를 해제하거나 매장을 옮겨도 예전 권한이
 * 남는다. 권한 계정(owner/admin/manager)은 요청마다 DB의 현재 역할·소속으로 다시 확인해 그 값으로 돌려준다
 * (계정이 없어졌으면 null). 일반 고객(user)은 권한이 없으므로 DB를 보지 않는다 — DB에서 승격됐더라도 다시
 * 로그인해야 반영되는 안전한 방향이다.
 */
export async function getFreshSession(): Promise<SessionPayload | null> {
  const session = await getSession();
  if (!session || session.role === "user") return session;
  await dbConnect();
  const u = await User.findById(session.sub).select("role name companyAdminOf storeManagerOf").lean();
  if (!u) return null;
  return {
    ...session,
    role: u.role,
    name: u.name,
    companyAdminOf: u.companyAdminOf ? String(u.companyAdminOf) : undefined,
    storeManagerOf: u.storeManagerOf ? String(u.storeManagerOf) : undefined,
  };
}
