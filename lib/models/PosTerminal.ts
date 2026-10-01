import mongoose, { Schema, models, model, Types } from "mongoose";

export interface IPosTerminal {
  _id: Types.ObjectId;
  storeId: Types.ObjectId;
  name: string;
  apiKey: string;
  status: "ACTIVE" | "REVOKED";
  registeredAt: Date;
  lastSeenAt?: Date;
  agentStatus?: { pending: number; skippedNoPhone: number; lastError?: string | null; lastErrorAt?: Date | null; reportedAt: Date };
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
  // 포스 프로그램이 하트비트에 실어 보내는 진단 정보 — 매장 관리모드에서 "미반영 적립·최근 오류"로 보여준다.
  agentStatus: { type: Schema.Types.Mixed },
});

export default (models.PosTerminal as mongoose.Model<IPosTerminal>) ||
  model<IPosTerminal>("PosTerminal", PosTerminalSchema);
