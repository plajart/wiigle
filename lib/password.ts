import crypto from "crypto";

export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 72; // bcrypt는 72바이트 넘는 부분을 무시한다

/** 새 비밀번호 검사 — 문제가 있으면 오류 코드를, 괜찮으면 null을 돌려준다. */
export function checkNewPassword(pw: unknown): "PASSWORD_TOO_SHORT" | "PASSWORD_TOO_LONG" | null {
  if (typeof pw !== "string" || pw.length < PASSWORD_MIN) return "PASSWORD_TOO_SHORT";
  if (Buffer.byteLength(pw, "utf8") > PASSWORD_MAX) return "PASSWORD_TOO_LONG";
  return null;
}

export function normalizePhone(phone: unknown): string {
  return typeof phone === "string" ? phone.replace(/[^0-9]/g, "") : "";
}

export function hashResetCode(phone: string, code: string): string {
  return crypto.createHash("sha256").update(`${phone}:${code}`).digest("hex");
}

export function safeEqualHex(a: string, b: string): boolean {
  const ba = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}
