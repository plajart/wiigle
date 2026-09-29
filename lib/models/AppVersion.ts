import mongoose, { Schema, models, model, Types } from "mongoose";

export interface IAppVersion {
  _id: Types.ObjectId;
  platform: "android";
  versionCode: number; // 클수록 최신(단순 증가값)
  versionName: string; // 사람이 보는 표시용, 예: "1.2.0"
  filename: string; // /web/concrab/uploads/app-releases/{filename} 실제 파일명
  changelog?: string;
  uploadedBy: Types.ObjectId;
  createdAt: Date;
}

const AppVersionSchema = new Schema<IAppVersion>({
  platform: { type: String, enum: ["android"], required: true, default: "android" },
  versionCode: { type: Number, required: true },
  versionName: { type: String, required: true },
  filename: { type: String, required: true },
  changelog: { type: String },
  uploadedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  createdAt: { type: Date, default: Date.now },
});

AppVersionSchema.index({ platform: 1, versionCode: -1 });

export default (models.AppVersion as mongoose.Model<IAppVersion>) ||
  model<IAppVersion>("AppVersion", AppVersionSchema);
