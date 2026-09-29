import mongoose, { Schema, models, model, Types } from "mongoose";

export type PosScope = "read_balance" | "read_history" | "write_redeem" | "write_earn" | "accept_transfer";

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
  createdAt: { type: Date, default: Date.now },
});

export default (models.Store as mongoose.Model<IStore>) || model<IStore>("Store", StoreSchema);
