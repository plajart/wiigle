import mongoose, { Schema, models, model, Types } from "mongoose";

// 본사(소유자)가 관리모드에서 켜고 끄는 플랫폼 전체 설정(키-값). 예: manualPointChangesEnabled(챔프 외 임의 포인트 변경 허용 여부, 기본 꺼짐).
export interface IPlatformSetting {
  _id: Types.ObjectId;
  key: string;
  value: boolean | string | number;
  updatedBy?: Types.ObjectId;
  updatedAt: Date;
}

const PlatformSettingSchema = new Schema<IPlatformSetting>({
  key: { type: String, required: true, unique: true },
  value: { type: Schema.Types.Mixed },
  updatedBy: { type: Schema.Types.ObjectId, ref: "User" },
  updatedAt: { type: Date, default: Date.now },
});

export default (models.PlatformSetting as mongoose.Model<IPlatformSetting>) || model<IPlatformSetting>("PlatformSetting", PlatformSettingSchema);
