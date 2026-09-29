import mongoose, { Schema, models, model, Types } from "mongoose";

export interface IPosTerminal {
  _id: Types.ObjectId;
  storeId: Types.ObjectId;
  name: string;
  apiKey: string;
  status: "ACTIVE" | "REVOKED";
  registeredAt: Date;
  lastSeenAt?: Date;
  isPrimary: boolean; // 매장 내 "대표 포스기" — 이 단말에서만 관리모드 바로가기를 노출. 매장당 1대만 true(지정 시 나머지는 자동 해제)
}

const PosTerminalSchema = new Schema<IPosTerminal>({
  storeId: { type: Schema.Types.ObjectId, ref: "Store", required: true },
  name: { type: String, required: true },
  apiKey: { type: String, required: true, unique: true },
  status: { type: String, enum: ["ACTIVE", "REVOKED"], default: "ACTIVE" },
  registeredAt: { type: Date, default: Date.now },
  lastSeenAt: { type: Date },
  isPrimary: { type: Boolean, default: false },
});

export default (models.PosTerminal as mongoose.Model<IPosTerminal>) ||
  model<IPosTerminal>("PosTerminal", PosTerminalSchema);
