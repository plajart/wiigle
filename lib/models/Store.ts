import mongoose, { Schema, models, model, Types } from "mongoose";

export type PosScope = "read_balance" | "read_history" | "write_redeem" | "write_earn" | "accept_transfer";

// 새 매장의 포스 연동 기본값 — 전부 켠 채 시작한다. 매장이 별도 설정 없이 기존 포스 프로그램만 써도 적립·사용이 고객사
// 단위로 통합되어 동작해야 하기 때문이다(예전에는 빈 값으로 시작해 "POS 연동 동의"를 직접 켜기 전까지 에이전트 호출이 403으로 막혔다).
// 특정 항목을 끄고 싶으면 매장 관리모드의 "POS 연동 동의"에서 끄면 된다.
export const DEFAULT_POS_SCOPES: PosScope[] = ["read_balance", "read_history", "write_redeem", "write_earn", "accept_transfer"];

export interface IStore {
  _id: Types.ObjectId;
  name: string;
  companyId: Types.ObjectId; // 소속 고객사 — 2026-09-30 도입, 모든 매장은 반드시 하나의 고객사에 속함
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
  createdAt: Date;
}

const StoreSchema = new Schema<IStore>({
  name: { type: String, required: true, trim: true },
  companyId: { type: Schema.Types.ObjectId, ref: "Company", required: true },
  franchiseCode: { type: String },
  posIntegration: {
    scopes: { type: [String], default: () => [...DEFAULT_POS_SCOPES] },
    grantedBy: { type: Schema.Types.ObjectId, ref: "User" },
    grantedAt: { type: Date },
  },
  vendorApi: {
    baseUrl: { type: String },
    apiKey: { type: String },
  },
  createdAt: { type: Date, default: Date.now },
});

// 매장 이름은 같은 고객사 안에서 중복 불가.
StoreSchema.index({ companyId: 1, name: 1 }, { unique: true });

export default (models.Store as mongoose.Model<IStore>) || model<IStore>("Store", StoreSchema);
