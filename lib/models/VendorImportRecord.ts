import mongoose, { Schema, models, model, Types } from "mongoose";

/**
 * "이 포스기의 로컬 DB에 있던 이 고객의 레거시 잔액을 이미 가져왔다"는 사실을
 * 포스기 단위로 기록한다. 매장 단위(PointAccount 존재 여부)로 판단하면, 같은 매장의
 * 다른 포스기에서 먼저 실적립/사용이 발생해 계좌가 생겨버린 고객은 이후 이 포스기의
 * 레거시 잔액을 영영 못 가져오게 된다 — 포스기들이 서로 동기화 안 된 별도 로컬 DB라
 * 이런 "매장은 같지만 포스기마다 남은 잔액이 다름" 상황이 실제로 생긴다.
 */
export interface IVendorImportRecord {
  _id: Types.ObjectId;
  storeId: Types.ObjectId;
  terminalId: Types.ObjectId;
  userId: Types.ObjectId;
  amount: number;
  source: "LAZY" | "BULK";
  importedAt: Date;
}

const VendorImportRecordSchema = new Schema<IVendorImportRecord>({
  storeId: { type: Schema.Types.ObjectId, ref: "Store", required: true },
  terminalId: { type: Schema.Types.ObjectId, ref: "PosTerminal", required: true },
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  amount: { type: Number, required: true },
  source: { type: String, enum: ["LAZY", "BULK"], required: true },
  importedAt: { type: Date, default: Date.now },
});

VendorImportRecordSchema.index({ terminalId: 1, userId: 1 }, { unique: true });

export default (models.VendorImportRecord as mongoose.Model<IVendorImportRecord>) ||
  model<IVendorImportRecord>("VendorImportRecord", VendorImportRecordSchema);
