import crypto from "crypto";
import mongoose, { Schema, models, model, Types } from "mongoose";

export function hashProvisionToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

// 포스 프로그램 다운로드 시 매장별로 발급하는 1회용 설치 토큰. 압축파일 안의 설정에 내장되어,
// 사람이 코드를 입력하지 않아도 프로그램이 처음 실행될 때 스스로 이 매장에 등록되게 한다.
// 원문 토큰은 DB에 저장하지 않고 해시만 저장한다(DB가 유출돼도 토큰을 쓸 수 없게).
export interface IPosProvisionToken {
  _id: Types.ObjectId;
  tokenHash: string;
  storeId: Types.ObjectId;
  issuedBy?: Types.ObjectId;
  createdAt: Date;
}

const PosProvisionTokenSchema = new Schema<IPosProvisionToken>({
  tokenHash: { type: String, required: true, unique: true },
  storeId: { type: Schema.Types.ObjectId, ref: "Store", required: true },
  issuedBy: { type: Schema.Types.ObjectId, ref: "User" },
  createdAt: { type: Date, default: Date.now, expires: 24 * 60 * 60 }, // 24시간 후 자동 만료(TTL 인덱스)
});

export default (models.PosProvisionToken as mongoose.Model<IPosProvisionToken>) ||
  model<IPosProvisionToken>("PosProvisionToken", PosProvisionTokenSchema);
