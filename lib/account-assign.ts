import "server-only";
import crypto from "crypto";
import User from "./models/User";
import Store from "./models/Store";
import Company from "./models/Company";
import { hashPassword } from "./auth";
import { issueDigitalCardNo } from "./card";
import { normalizePhone } from "./password";
import { ApiError } from "./rbac";

/**
 * 고객사 운영자·매장 관리자 "지정" 로직 — 본사(소유자)가 고객사 운영자를, 고객사 운영자가 매장 관리자를 지정할 때 공통으로 쓴다.
 *
 * 규칙
 *  - 한 계정은 하나의 등급만 갖는다(user/manager/admin/owner). 본사(소유자)·(다른 등급) 계정은 여기서 바꾸지 않는다.
 *  - 이미 가입한 회원이면 그 계정을 승격한다(본인 비밀번호 그대로). 가입 안 한 번호면 이름을 받아 계정을 새로 만든다 —
 *    문자 인증이 없어 본인이 먼저 가입할 수 없기 때문. 새로 만들 때는 **임의 임시 비밀번호를 부여해 지정한 사람에게
 *    한 번만 알려준다**(권한 계정의 비밀번호는 로그인 화면에서 공개하지 않는다). 지정한 사람이 본인에게 안전하게
 *    전하고, 본인은 그 비밀번호로 로그인한 뒤 변경하도록 첫 로그인 때 한 번 안내한다.
 */
export type AssignResult = { userId: string; name: string; phone: string; created: boolean; tempPassword?: string };

async function findByPhone(rawPhone: unknown) {
  const phone = normalizePhone(rawPhone);
  if (phone.length < 9) throw new ApiError(400, "INVALID_PHONE");
  const user = await User.findOne({ phone: { $in: [phone, String(rawPhone)] } });
  return { phone, user };
}

async function newTempPassword() {
  const tempPassword = crypto.randomBytes(9).toString("base64url");
  return { tempPassword, passwordHash: await hashPassword(tempPassword) };
}

async function createAccount(phone: string, name: unknown, fields: Record<string, unknown>) {
  const cleanName = typeof name === "string" ? name.trim() : "";
  if (!cleanName) throw new ApiError(404, "USER_NOT_FOUND"); // 가입 안 된 번호 — 이름을 입력하면 계정을 만든다
  const { tempPassword, passwordHash } = await newTempPassword();
  const user = await User.create({
    phone,
    name: cleanName,
    passwordHash,
    phoneVerified: true,
    digitalCardNo: await issueDigitalCardNo(),
    firstLogin: true, // 임시 비밀번호로 처음 로그인하면 "비밀번호를 변경하세요" 안내를 한 번 보여준다
    ...fields,
  });
  return { user, tempPassword };
}

/** 매장 관리자(manager) 지정. 같은 매장에 여러 명을 둘 수 있다. */
export async function assignManager(storeId: string, rawPhone: unknown, name?: unknown): Promise<AssignResult> {
  const store = await Store.findById(storeId).select("companyId").lean();
  if (!store) throw new ApiError(404, "STORE_NOT_FOUND");
  const { phone, user } = await findByPhone(rawPhone);

  if (!user) {
    const { user: created, tempPassword } = await createAccount(phone, name, { role: "manager", storeManagerOf: storeId });
    return { userId: String(created._id), name: created.name, phone, created: true, tempPassword };
  }
  if (user.role === "owner" || user.role === "admin") throw new ApiError(409, "CANNOT_CHANGE_THIS_ROLE");
  if (user.role === "manager") {
    if (String(user.storeManagerOf) === String(storeId)) throw new ApiError(409, "ALREADY_MANAGER");
    // 다른 매장 관리자를 옮길 수는 있지만, 다른 고객사 소속 매장의 관리자를 가로채지는 못한다.
    const current = user.storeManagerOf ? await Store.findById(user.storeManagerOf).select("companyId").lean() : null;
    if (!current || String(current.companyId) !== String(store.companyId)) throw new ApiError(409, "MANAGER_OF_OTHER_COMPANY");
  }
  let tempPassword: string | undefined;
  if (!user.passwordHash) {
    const t = await newTempPassword();
    user.passwordHash = t.passwordHash;
    tempPassword = t.tempPassword;
    user.firstLogin = true;
  }
  user.initialPassword = undefined; // 권한 계정이 되면 로그인 화면이 초기 비밀번호를 알려주지 않게
  user.role = "manager";
  user.storeManagerOf = store._id;
  user.companyAdminOf = undefined;
  await user.save();
  return { userId: String(user._id), name: user.name, phone: user.phone, created: false, tempPassword };
}

/** 매장 관리자 해제 — 일반 고객으로 되돌린다. */
export async function unassignManager(storeId: string, userId: string) {
  const user = await User.findById(userId);
  if (!user || user.role !== "manager" || String(user.storeManagerOf) !== String(storeId)) {
    throw new ApiError(404, "MANAGER_NOT_FOUND");
  }
  user.role = "user";
  user.storeManagerOf = undefined;
  await user.save();
  return user;
}

/** 고객사 운영자(admin) 지정 — 본사(소유자)만 호출한다. 다른 고객사의 운영자를 이 고객사로 옮길 수도 있다. */
export async function assignCompanyAdmin(companyId: string, rawPhone: unknown, name?: unknown): Promise<AssignResult> {
  const company = await Company.findById(companyId).select("_id").lean();
  if (!company) throw new ApiError(404, "COMPANY_NOT_FOUND");
  const { phone, user } = await findByPhone(rawPhone);

  if (!user) {
    const { user: created, tempPassword } = await createAccount(phone, name, { role: "admin", companyAdminOf: company._id });
    return { userId: String(created._id), name: created.name, phone, created: true, tempPassword };
  }
  // 본사(소유자)와 매장 관리자는 여기서 바꾸지 않는다(한 계정은 한 등급 — 매장 관리자를 운영자로 바꾸면 매장 권한이 사라진다).
  if (user.role === "owner" || user.role === "manager") throw new ApiError(409, "CANNOT_CHANGE_THIS_ROLE");
  let tempPassword: string | undefined;
  if (!user.passwordHash) {
    const t = await newTempPassword();
    user.passwordHash = t.passwordHash;
    tempPassword = t.tempPassword;
    user.firstLogin = true;
  }
  user.initialPassword = undefined; // 권한 계정이 되면 로그인 화면이 초기 비밀번호를 알려주지 않게
  user.role = "admin";
  user.companyAdminOf = company._id;
  user.storeManagerOf = undefined;
  await user.save();
  return { userId: String(user._id), name: user.name, phone: user.phone, created: false, tempPassword };
}
