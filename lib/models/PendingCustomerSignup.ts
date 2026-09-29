import mongoose, { Schema, models, model, Types } from "mongoose";

/**
 * 자가가입(웹 회원가입)은 전화번호 소유를 증명하기 전까지 진짜 User 문서를 만들지 않는다
 * (2026-09-29 보안점검 수정). 예전엔 가입 즉시 User(phone unique)를 만들고 나중에 OTP로
 * phoneVerified만 바꿨는데, phone이 유니크라 그 시점에 이미 그 번호를 "선점"해버려서
 * — OTP 코드가 응답에 그대로 노출되던 문제(SMS 미연동 dev 편법)와 겹쳐 —
 * 누구나 타인의 전화번호로 계정을 만들어 포스에서 그 번호로 적립되는 진짜 손님의 포인트를
 * 가로챌 수 있었다(POS의 getOrCreateUserByPhone은 phoneVerified를 안 보고 존재만 봄).
 * 이제는 여기(임시 보관)에 넣어두고, OTP 검증에 성공한 순간에만 진짜 User를 만든다.
 */
export interface IPendingCustomerSignup {
  _id: Types.ObjectId;
  phone: string;
  name: string;
  passwordHash: string;
  storeRef?: Types.ObjectId;
  otpCode: string;
  otpExpiresAt: Date;
  createdAt: Date;
}

const PendingCustomerSignupSchema = new Schema<IPendingCustomerSignup>({
  phone: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  passwordHash: { type: String, required: true },
  storeRef: { type: Schema.Types.ObjectId, ref: "Store" },
  otpCode: { type: String, required: true },
  otpExpiresAt: { type: Date, required: true },
  createdAt: { type: Date, default: Date.now, expires: 900 }, // 15분 후 자동 소멸(TTL) — 재시도는 새로 가입 요청하면 됨
});

export default (models.PendingCustomerSignup as mongoose.Model<IPendingCustomerSignup>) ||
  model<IPendingCustomerSignup>("PendingCustomerSignup", PendingCustomerSignupSchema);
