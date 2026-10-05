import mongoose, { Schema, models, model, Types } from "mongoose";

// 고객사 — 2026-09-30 도입. 하나의 고객사 아래에 매장이 하나 또는 여러 개 있고, 통합포인트는 고객사 단위로 운영된다.
// 이름은 본사(owner) 관리모드에서 언제든 바꿀 수 있다(고정 식별자가 아니라 표시용).
export interface ICompany {
  _id: Types.ObjectId;
  name: string;
  createdAt: Date;
  customerWebEnabled?: boolean; // false면 이 고객사의 고객은 웹에서 포인트를 조회할 수 없다(본사가 고객사별로 끄고 켠다). 기본 true
}

const CompanySchema = new Schema<ICompany>({
  name: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
  customerWebEnabled: { type: Boolean, default: true },
});

export default (models.Company as mongoose.Model<ICompany>) || model<ICompany>("Company", CompanySchema);
