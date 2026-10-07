import mongoose, { Schema, models, model, Types } from "mongoose";

/**
 * 포스 포인트 서버 이전에서 "자동으로 더하지 않고 사람이 확인해야 하는" 건.
 * - MORE_THAN_IMPORTED: 같은 포스기에서 이미 이전한 고객인데 포스 잔액이 이전 기록보다 많다(어디서 늘었는지 모름) — amount 는 늘어난 만큼(초과분).
 * - STORE_REPLICA_SUSPECT: 같은 매장의 다른 포스기에서 이미 이전한 고객과 잔액이 거의 같다 — 포스기들의 DB 가 서로 복제돼 같은 포인트를
 *   각 포스기가 따로 보내는 것일 수 있다(그대로 더하면 포스기 수만큼 부풀어 오른다) — amount 는 이번 포스기의 잔액 전체.
 * 본사 관리모드 "운영 점검·복구"에서 승인(서버에 더함) 또는 기각(더하지 않고 포스 잔액만 정리)한다. 둘 다 이후 같은 잔액이 다시 와도
 * 이미 처리된 것으로 본다(포스 프로그램이 포스 잔액을 0으로 정리).
 */
export type ImportHoldKind = "MORE_THAN_IMPORTED" | "STORE_REPLICA_SUSPECT";
export type ImportHoldStatus = "OPEN" | "APPROVED" | "DISMISSED";

export interface IImportHold {
  _id: Types.ObjectId;
  companyId?: Types.ObjectId;
  storeId: Types.ObjectId;
  terminalId: Types.ObjectId;
  userId: Types.ObjectId;
  phone: string;
  kind: ImportHoldKind;
  balance: number; // 이번에 포스기가 보낸 포스 잔액
  amount: number; // 승인하면 서버에 더해지는 금액
  previous: number; // 비교 기준(같은 포스기의 이전 이전 합계, 또는 다른 포스기가 이전한 금액)
  batchId?: string;
  status: ImportHoldStatus;
  createdAt: Date;
  lastSeenAt: Date;
  resolvedBy?: Types.ObjectId;
  resolvedAt?: Date;
  note?: string;
}

const ImportHoldSchema = new Schema<IImportHold>({
  companyId: { type: Schema.Types.ObjectId, ref: "Company" },
  storeId: { type: Schema.Types.ObjectId, ref: "Store", required: true },
  terminalId: { type: Schema.Types.ObjectId, ref: "PosTerminal", required: true },
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  phone: { type: String, required: true },
  kind: { type: String, enum: ["MORE_THAN_IMPORTED", "STORE_REPLICA_SUSPECT"], required: true },
  balance: { type: Number, required: true },
  amount: { type: Number, required: true },
  previous: { type: Number, default: 0 },
  batchId: { type: String },
  status: { type: String, enum: ["OPEN", "APPROVED", "DISMISSED"], default: "OPEN" },
  createdAt: { type: Date, default: Date.now },
  lastSeenAt: { type: Date, default: Date.now },
  resolvedBy: { type: Schema.Types.ObjectId, ref: "User" },
  resolvedAt: { type: Date },
  note: { type: String },
});
ImportHoldSchema.index({ storeId: 1, status: 1, createdAt: -1 });
ImportHoldSchema.index({ terminalId: 1, userId: 1, status: 1 });

export default (models.ImportHold as mongoose.Model<IImportHold>) || model<IImportHold>("ImportHold", ImportHoldSchema);
