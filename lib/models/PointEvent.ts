import mongoose, { Schema, models, model, Types } from "mongoose";

export type PointEventType =
  | "EARN"
  | "REDEEM"
  | "TRANSFER_OUT"
  | "TRANSFER_IN"
  | "GRANT"
  | "ADJUST"
  | "VENDOR_EARN" // 벤더(챔프 등) POS가 자체적으로 적립한 내역을 동기화로 반영
  | "VENDOR_USE" // 벤더 POS 결제화면에서 계산원이 포인트를 사용(차감)한 내역을 동기화로 반영
  | "VENDOR_IMPORT"; // 카드 최초 연결 시 벤더 POS에 이미 있던 잔액을 1회성으로 가져옴

export type PointEventStatus = "PENDING" | "APPROVED" | "REJECTED" | "CONFIRMED";

export interface IPointEvent {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  storeId: Types.ObjectId | null;
  companyId?: Types.ObjectId; // 이 내역이 속한 고객사(통합포인트 지급·조정은 storeId가 없어도 고객사가 있다)
  sourceType?: "STORE" | "HQ"; // 이체 요청 시 출처
  sourceStoreId?: Types.ObjectId | null;
  type: PointEventType;
  amount: number;
  status: PointEventStatus;
  approvedBy?: Types.ObjectId;
  reason?: string;
  vendorTxnId?: string; // 벤더 동기화 이벤트의 멱등키 (storeId 범위 내 고유) — 재전송돼도 중복 반영 방지
  clientTxnId?: string; // POS 앱(적립/차감)에서 발급하는 멱등키 — 새로고침/이중클릭으로 인한 중복 반영 방지
  terminalId?: Types.ObjectId | null; // 어느 POS 단말에서 발생했는지 — 일일 정산 집계용 정식 필드(2026-09-27)
  cardNo?: string; // 결제에 쓰인 벤더 POS 회원카드 식별번호 — 소유권 매핑이 아니라 그 거래 시점의 사실만 기록(카드는 빌려 쓸 수 있어 신원 증거로 쓰지 않음)
  occurredAt: Date;
}

const PointEventSchema = new Schema<IPointEvent>({
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  storeId: { type: Schema.Types.ObjectId, ref: "Store", default: null },
  companyId: { type: Schema.Types.ObjectId, ref: "Company" },
  sourceType: { type: String, enum: ["STORE", "HQ"] },
  sourceStoreId: { type: Schema.Types.ObjectId, ref: "Store", default: null },
  type: {
    type: String,
    enum: [
      "EARN",
      "REDEEM",
      "TRANSFER_OUT",
      "TRANSFER_IN",
      "GRANT",
      "ADJUST",
      "VENDOR_EARN",
      "VENDOR_USE",
      "VENDOR_IMPORT",
    ],
    required: true,
  },
  amount: { type: Number, required: true },
  status: {
    type: String,
    enum: ["PENDING", "APPROVED", "REJECTED", "CONFIRMED"],
    required: true,
    default: "CONFIRMED",
  },
  approvedBy: { type: Schema.Types.ObjectId, ref: "User" },
  reason: { type: String },
  vendorTxnId: { type: String },
  clientTxnId: { type: String },
  terminalId: { type: Schema.Types.ObjectId, ref: "PosTerminal", default: null },
  cardNo: { type: String },
  occurredAt: { type: Date, default: Date.now },
});

// 고객 화면(고객사별 이용내역)·고객사 운영자 고객 조회가 훑는 쿼리
PointEventSchema.index({ userId: 1, companyId: 1, occurredAt: -1 });

// 매장의 일일 정산(날짜별 집계, 단말별 상세)이 훑는 쿼리 — 항상 storeId+occurredAt 범위로 조회한다.
PointEventSchema.index({ storeId: 1, occurredAt: -1 });

// 같은 매장 안에서 벤더 이벤트 멱등키가 겹치면 안 됨(재동기화 시 중복반영 방지).
// vendorTxnId가 없는(우리 시스템 자체 이벤트, posEarn/posCheckout 등) 문서는 이 인덱스
// 대상에서 빠져야 한다 — sparse는 "필드가 아예 없는" 문서만 제외하는데, 실제로는 여러
// 문서가 vendorTxnId=null로 저장되어 sparse+unique 조합이 null끼리 충돌하는 문제가
// 있었다(실측 확인). partialFilterExpression으로 "문자열 값이 있는 문서만" 명시적으로
// 인덱스 대상을 좁혀서 null/누락 문서는 충돌 없이 몇 개든 존재할 수 있게 한다.
PointEventSchema.index(
  { storeId: 1, vendorTxnId: 1 },
  { unique: true, partialFilterExpression: { vendorTxnId: { $type: "string" } } }
);
// 계산원 화면(적립/차감)에서 새로고침·이중클릭으로 같은 요청이 두 번 가면 안 됨 — 같은 이유로
// partialFilterExpression 사용(문자열 값이 있는 문서만 유일성 검사 대상).
PointEventSchema.index(
  { storeId: 1, clientTxnId: 1 },
  { unique: true, partialFilterExpression: { clientTxnId: { $type: "string" } } }
);

export default (models.PointEvent as mongoose.Model<IPointEvent>) ||
  model<IPointEvent>("PointEvent", PointEventSchema);
