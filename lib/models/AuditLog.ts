import mongoose, { Schema, models, model, Types } from "mongoose";

export interface IAuditLog {
  _id: Types.ObjectId;
  storeId: Types.ObjectId | null;
  actorType: "AGENT" | "STORE_ADMIN" | "HQ_ADMIN" | "CUSTOMER";
  actorId?: Types.ObjectId;
  action: string;
  scope?: string;
  meta?: Record<string, unknown>;
  occurredAt: Date;
}

const AuditLogSchema = new Schema<IAuditLog>({
  storeId: { type: Schema.Types.ObjectId, ref: "Store", default: null },
  actorType: { type: String, enum: ["AGENT", "STORE_ADMIN", "HQ_ADMIN", "CUSTOMER"], required: true },
  actorId: { type: Schema.Types.ObjectId, ref: "User" },
  action: { type: String, required: true },
  scope: { type: String },
  meta: { type: Schema.Types.Mixed },
  occurredAt: { type: Date, default: Date.now },
});

export default (models.AuditLog as mongoose.Model<IAuditLog>) ||
  model<IAuditLog>("AuditLog", AuditLogSchema);
