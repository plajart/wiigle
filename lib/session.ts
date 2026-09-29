import "server-only";
import { cookies } from "next/headers";
import { SESSION_COOKIE, SessionPayload, verifySession } from "./auth";

export async function getSession(): Promise<SessionPayload | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifySession(token);
}
