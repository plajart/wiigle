import mongoose, { Schema, models, model, Types } from "mongoose";

export type PosScope = "read_balance" | "read_history" | "write_redeem" | "write_earn" | "accept_transfer";

export interface IStore {
  _id: Types.ObjectId;
  name: string;
  companyId: Types.ObjectId; // 소속 고객사(본사) — 2026-09-30 도입, 모든 매장은 반드시 하나의 고객사에 속함
  franchiseCode?: string;
  posIntegration: {
    scopes: PosScope[];
    grantedBy?: Types.ObjectId;
    grantedAt?: Date;
  };
  vendorApi?: {
    baseUrl: string; // 예: http://192.168.45.240:8787
    apiKey: string;
  };
  // 벤더 POS(챔프 등)에서 결제가 확정될 때마다 자동 적립할 비율. 벤더 자체의 적립 규칙이
  // 설정 안 돼 있는 매장이 많아(예: 챔프 MEM_SALES_POINT 미사용) 벤더 값을 그대로
  // 동기화하는 대신 우리 서버가 결제금액 기준으로 직접 계산해 적립한다.
  pointPolicy?: {
    earnRate: number; // 0.03 = 결제금액의 3%
  };
  createdAt: Date;
}

const StoreSchema = new Schema<IStore>({
  name: { type: String, required: true },
  companyId: { type: Schema.Types.ObjectId, ref: "Company", required: true },
  franchiseCode: { type: String },
  posIntegration: {
    scopes: { type: [String], default: [] },
    grantedBy: { type: Schema.Types.ObjectId, ref: "User" },
    grantedAt: { type: Date },
  },
  vendorApi: {
    baseUrl: { type: String },
    apiKey: { type: String },
  },
  pointPolicy: {
    earnRate: { type: Number, default: 0.03 },
  },
  createdAt: { type: Date, default: Date.now },
});

export default (models.Store as mongoose.Model<IStore>) || model<IStore>("Store", StoreSchema);
