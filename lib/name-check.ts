import "server-only";
import Company from "./models/Company";
import Store from "./models/Store";
import { ApiError } from "./rbac";

// 고객사 이름은 전체에서, 매장 이름은 같은 고객사 안에서 겹치지 않게 한다(DB 유니크 인덱스가 최종 방어선, 여기서는 먼저 친절한 오류를 낸다).
export function cleanName(name: unknown): string {
  return typeof name === "string" ? name.trim().replace(/\s+/g, " ").slice(0, 100) : "";
}

export async function assertCompanyNameFree(name: string, exceptId?: string) {
  const dup = await Company.findOne({ name, ...(exceptId ? { _id: { $ne: exceptId } } : {}) }).select("_id").lean();
  if (dup) throw new ApiError(409, "COMPANY_NAME_IN_USE");
}

export async function assertStoreNameFree(companyId: unknown, name: string, exceptId?: string) {
  const dup = await Store.findOne({ companyId, name, ...(exceptId ? { _id: { $ne: exceptId } } : {}) }).select("_id").lean();
  if (dup) throw new ApiError(409, "STORE_NAME_IN_USE");
}

/** 동시에 같은 이름이 만들어져 DB 유니크 인덱스에 걸린 경우를 같은 오류로 바꾼다. */
export function duplicateAs(e: unknown, code: "COMPANY_NAME_IN_USE" | "STORE_NAME_IN_USE"): never {
  if ((e as { code?: number })?.code === 11000) throw new ApiError(409, code);
  throw e;
}
