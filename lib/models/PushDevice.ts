import mongoose, { Schema, models, model, Types } from "mongoose";

// 비밀번호 찾기 인증번호를 받을 앱(브라우저) 기기 — 전화번호에 묶어 둔다. 한 기기(endpoint)는
// 한 번호에만 묶이고, 한 번호에는 최대 3대까지(오래된 것부터 교체).
export interface IPushDevice {
  _id: Types.ObjectId;
  phone: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  createdAt: Date;
}

const PushDeviceSchema = new Schema<IPushDevice>({
  phone: { type: String, required: true, index: true },
  endpoint: { type: String, required: true, unique: true },
  p256dh: { type: String, required: true },
  auth: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
});

export default (models.PushDevice as mongoose.Model<IPushDevice>) || model<IPushDevice>("PushDevice", PushDeviceSchema);
