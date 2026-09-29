import "server-only";
import { cookies } from "next/headers";
import mongoose from "mongoose";
import type { SessionPayload } from "./auth";
import { dbConnect } from "./mongodb";
import Company from "./models/Company";

// 소유자가 "본사(고객사) 관리모드"로 들어가 있는 동안 현재 고객사를 기억하는 쿠키.
// /hq/enter?companyId= 를 거치면 설정된다. 값은 신뢰하지 않고 매 요청마다 존재 여부를 다시 확인한다.
export const COMPANY_CONTEXT_COOKIE = "pm_company";

/**
 * 지금 이 세션이 보고 있는 고객사(본사)를 결정한다.
 * - admin(운영자): 자기 고객사(companyAdminOf) 고정.
 * - owner(소유자): 본사 관리모드 진입 시 저장된 쿠키의 고객사(존재할 때만).
 * 결정할 수 없으면 null.
 */
export async function resolveCompanyId(session: SessionPayload): Promise<string | null> {
  if (session.role === "admin") return session.companyAdminOf ?? null;
  if (session.role !== "owner") return null;

  const candidate = (await cookies()).get(COMPANY_CONTEXT_COOKIE)?.value;
  if (!candidate || !mongoose.isValidObjectId(candidate)) return null;
  await dbConnect();
  const exists = await Company.exists({ _id: candidate });
  return exists ? candidate : null;
}
