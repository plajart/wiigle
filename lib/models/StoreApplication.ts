import mongoose, { Schema, models, model, Types } from "mongoose";

export type ApplicationStatus = "PENDING" | "APPROVED" | "REJECTED";

export interface IStoreApplication {
  _id: Types.ObjectId;
  companyName: string; // 새로 생길 고객사(본사) 이름 — 승인 시 Company와 첫 매장이 함께 생성됨
  storeName: string;
  franchiseCode?: string;
  applicantName: string;
  applicantPhone: string;
  passwordHash: string;
  status: ApplicationStatus;
  rejectReason?: string;
  reviewedBy?: Types.ObjectId;
  reviewedAt?: Date;
  createdCompanyId?: Types.ObjectId; // 승인 시 생성된 Company
  createdStoreId?: Types.ObjectId; // 승인 시 생성된 Store
  createdUserId?: Types.ObjectId; // 승인 시 생성된 manager 계정
  appliedAt: Date;
}

const StoreApplicationSchema = new Schema<IStoreApplication>({
  companyName: { type: String, required: true },
  storeName: { type: String, required: true },
  franchiseCode: { type: String },
  applicantName: { type: String, required: true },
  applicantPhone: { type: String, required: true },
  passwordHash: { type: String, required: true },
  status: { type: String, enum: ["PENDING", "APPROVED", "REJECTED"], default: "PENDING" },
  rejectReason: { type: String },
  reviewedBy: { type: Schema.Types.ObjectId, ref: "User" },
  reviewedAt: { type: Date },
  createdCompanyId: { type: Schema.Types.ObjectId, ref: "Company" },
  createdStoreId: { type: Schema.Types.ObjectId, ref: "Store" },
  createdUserId: { type: Schema.Types.ObjectId, ref: "User" },
  appliedAt: { type: Date, default: Date.now },
});

export default (models.StoreApplication as mongoose.Model<IStoreApplication>) ||
  model<IStoreApplication>("StoreApplication", StoreApplicationSchema);
