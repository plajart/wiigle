import mongoose, { Schema, models, model, Types } from "mongoose";

// 비밀번호 찾기용 1회성 인증번호 — 전화번호당 하나만 유지(재요청하면 덮어쓴다).
// 인증번호 원문은 저장하지 않고 해시만 저장하며, 5분 뒤 자동 소멸(TTL)한다.
export interface IPasswordReset {
  _id: Types.ObjectId;
  phone: string;
  codeHash: string;
  attempts: number; // 틀린 시도 횟수 — 너무 많으면 이 인증번호는 폐기
  expiresAt: Date;
  createdAt: Date;
}

const PasswordResetSchema = new Schema<IPasswordReset>({
  phone: { type: String, required: true, unique: true },
  codeHash: { type: String, required: true },
  attempts: { type: Number, default: 0 },
  expiresAt: { type: Date, required: true },
  createdAt: { type: Date, default: Date.now, expires: 300 },
});

export default (models.PasswordReset as mongoose.Model<IPasswordReset>) ||
  model<IPasswordReset>("PasswordReset", PasswordResetSchema);
