import mongoose, { Schema, models, model, Types } from "mongoose";

export interface IPosPairingCode {
  _id: Types.ObjectId;
  code: string;
  storeId: Types.ObjectId;
  createdAt: Date;
}

const PosPairingCodeSchema = new Schema<IPosPairingCode>({
  code: { type: String, required: true, unique: true },
  storeId: { type: Schema.Types.ObjectId, ref: "Store", required: true },
  createdAt: { type: Date, default: Date.now, expires: 600 }, // 10분 후 자동 만료(TTL 인덱스)
});

export default (models.PosPairingCode as mongoose.Model<IPosPairingCode>) ||
  model<IPosPairingCode>("PosPairingCode", PosPairingCodeSchema);
