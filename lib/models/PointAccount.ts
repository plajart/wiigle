import mongoose, { Schema, models, model, Types } from "mongoose";

export type PointAccountType = "STORE" | "HQ";

export interface IPointAccount {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  storeId: Types.ObjectId | null; // null = 통합포인트(고객사가 지급한 분)
  // 이 계좌가 속한 고객사 — 통합포인트는 고객사별로 따로 쌓이고, 잔액 합산·차감은 같은 고객사 안에서만 한다.
  // 매장 계좌는 그 매장의 고객사와 같다.
  companyId: Types.ObjectId;
  type: PointAccountType;
  balance: number;
}

const PointAccountSchema = new Schema<IPointAccount>({
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  storeId: { type: Schema.Types.ObjectId, ref: "Store", default: null },
  companyId: { type: Schema.Types.ObjectId, ref: "Company", required: true },
  type: { type: String, enum: ["STORE", "HQ"], required: true },
  balance: { type: Number, required: true, default: 0 },
});

// 예전(고객사 도입 전)에는 { userId, storeId, type } 유니크였다 — 그 인덱스는 사용자당 통합포인트(storeId=null) 계좌를 1개로
// 묶어 고객사별 계좌를 막으므로 scripts/migrate-company-points.ts가 지운다.
PointAccountSchema.index({ userId: 1, storeId: 1, type: 1, companyId: 1 }, { unique: true });
PointAccountSchema.index({ companyId: 1, userId: 1 });

export default (models.PointAccount as mongoose.Model<IPointAccount>) ||
  model<IPointAccount>("PointAccount", PointAccountSchema);
