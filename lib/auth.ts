import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import type { UserRole } from "./models/User";

const secret = new TextEncoder().encode(process.env.NEXTAUTH_SECRET || "dev-only-insecure-secret");

// 모든 로그인 계정은 회원(member)이며, owner/admin/manager 등급은 얹혀지는 것이지
// 계정 종류가 아니다. role이 "user"(기본값)면 일반 회원(고객).
export type SessionPayload = {
  sub: string; // userId
  name: string;
  role: UserRole;
  companyAdminOf?: string; // role="admin"일 때 — 관리하는 고객사
  storeManagerOf?: string; // role="manager"일 때 — 관리하는 매장
  fl?: boolean; // 초기/임시 비밀번호로 방금 첫 로그인한 세션 — 비밀번호 변경 안내 화면에서 현재 비밀번호 입력을 생략(1시간 이내)
};

export async function hashPassword(pw: string) {
  return bcrypt.hash(pw, 10);
}

export async function verifyPassword(pw: string, hash: string) {
  return bcrypt.compare(pw, hash);
}

export async function signSession(payload: SessionPayload) {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(secret);
}

export async function verifySession(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secret);
    return payload as unknown as SessionPayload;
  } catch {
    return null;
  }
}

export const SESSION_COOKIE = "pm_session";
