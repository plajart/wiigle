import mongoose, { Schema, models, model, Types } from "mongoose";

export interface IClaimToken {
  _id: Types.ObjectId;
  token: string;
  storeId: Types.ObjectId;
  cardNo: string;
  createdAt: Date;
}

// 영수증에 인쇄되는 QR용 단발성 토큰 — 미가입 카드 소지자가 스캔해서 가입/연결하는 용도.
// 30분 후 자동 만료(TTL). 카드번호를 QR에 직접 노출하지 않기 위한 간접 참조.
const ClaimTokenSchema = new Schema<IClaimToken>({
  token: { type: String, required: true, unique: true },
  storeId: { type: Schema.Types.ObjectId, ref: "Store", required: true },
  cardNo: { type: String, required: true },
  createdAt: { type: Date, default: Date.now, expires: 1800 },
});

export default (models.ClaimToken as mongoose.Model<IClaimToken>) ||
  model<IClaimToken>("ClaimToken", ClaimTokenSchema);
