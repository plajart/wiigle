import mongoose, { Schema, models, model, Types } from "mongoose";

// 포스기 ↔ 서버 사이의 포인트 이동 기록 — 문제가 생겼을 때 "언제, 어느 고객사·매장·포스기에서, 누구의 포인트가, 얼마가, 어느 방향으로
// 옮겨졌는지"를 추적하기 위한 장부. 잔액 자체를 바꾸는 기록(PointEvent)과 별개로, 이동·동기화 사실만 남긴다.
export type PosTransferKind =
  | "LOOKUP_TO_POS" // 사용 조회: 서버 가용 포인트를 포스 화면(로컬)에 더함
  | "RESTORE_POS" // 결제 후/시간초과: 포스 로컬 잔액을 0으로 되돌림
  | "EARN_TO_SERVER" // 포스 적립분을 서버로 이전(로컬 차감)
  | "USE_TO_SERVER" // 포스에서 사용한 포인트를 서버에서 차감
  | "EARN_CANCEL" // 결제 취소로 적립 취소
  | "USE_CANCEL" // 결제 취소로 사용 취소(환원)
  | "BULK_IMPORT" // 포스기 초기 설치 시 기존 포인트 일괄 이전
  | "SKIPPED" // 전화번호 없음 등으로 서버 반영을 건너뜀(보류)
  | "REJECTED"; // 서버가 거부해 건너뜀

export interface IPosTransferLog {
  _id: Types.ObjectId;
  companyId?: Types.ObjectId;
  storeId: Types.ObjectId;
  terminalId?: Types.ObjectId;
  userId?: Types.ObjectId;
  phone?: string;
  kind: PosTransferKind;
  direction: "POS_TO_SERVER" | "SERVER_TO_POS" | "NONE";
  amount: number;
  localBefore?: number;
  localAfter?: number;
  serverBalanceAfter?: number;
  vendorTxnId?: string;
  occurredAt: Date; // 포스에서 실제 발생한 시각(오프라인이었다면 그때)
  recordedAt: Date; // 서버가 받아 기록한 시각
  delaySec?: number; // recordedAt - occurredAt (인터넷이 끊겼다 복구된 건을 가려내는 용도)
  offline?: boolean; // 지연이 커서 오프라인 후 뒤늦게 반영된 건
  note?: string;
}

const PosTransferLogSchema = new Schema<IPosTransferLog>({
  companyId: { type: Schema.Types.ObjectId, ref: "Company" },
  storeId: { type: Schema.Types.ObjectId, ref: "Store", required: true },
  terminalId: { type: Schema.Types.ObjectId, ref: "PosTerminal" },
  userId: { type: Schema.Types.ObjectId, ref: "User" },
  phone: { type: String },
  kind: { type: String, required: true },
  direction: { type: String, enum: ["POS_TO_SERVER", "SERVER_TO_POS", "NONE"], default: "NONE" },
  amount: { type: Number, default: 0 },
  localBefore: { type: Number },
  localAfter: { type: Number },
  serverBalanceAfter: { type: Number },
  vendorTxnId: { type: String },
  occurredAt: { type: Date, default: Date.now },
  recordedAt: { type: Date, default: Date.now },
  delaySec: { type: Number },
  offline: { type: Boolean, default: false },
  note: { type: String },
});
PosTransferLogSchema.index({ storeId: 1, recordedAt: -1 });
PosTransferLogSchema.index({ userId: 1, recordedAt: -1 });

export default (models.PosTransferLog as mongoose.Model<IPosTransferLog>) ||
  model<IPosTransferLog>("PosTransferLog", PosTransferLogSchema);
