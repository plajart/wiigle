import mongoose, { Schema, models, model, Types } from "mongoose";

export type PointAccountType = "STORE" | "HQ";

export interface IPointAccount {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  storeId: Types.ObjectId | null; // null = 본사 포인트
  type: PointAccountType;
  balance: number;
}

const PointAccountSchema = new Schema<IPointAccount>({
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  storeId: { type: Schema.Types.ObjectId, ref: "Store", default: null },
  type: { type: String, enum: ["STORE", "HQ"], required: true },
  balance: { type: Number, required: true, default: 0 },
});

PointAccountSchema.index({ userId: 1, storeId: 1, type: 1 }, { unique: true });

export default (models.PointAccount as mongoose.Model<IPointAccount>) ||
  model<IPointAccount>("PointAccount", PointAccountSchema);
