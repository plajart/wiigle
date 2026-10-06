import mongoose, { Schema, models, model, Types } from "mongoose";

/**
 * 같은 고객의 "가용 잔액"을 두 포스기(다른 매장이든 같은 매장이든)에서 거의 동시에 조회해
 * 각자 화면에 띄운 뒤 각각 사용해버리면, 서버 잔액은 하나인데 두 번 나가는 이중사용이
 * 생길 수 있다(2026-09-28, 사용자 지적). 흔치 않은 경우지만, 조회~사용 완료 사이 고객
 * 단위로 잠가 두 번째 조회를 막는다. TTL로 자동 해제(에이전트의 180초 타임아웃-원복보다
 * 넉넉하게 잡아 서버 잠금이 먼저 풀려버리는 일이 없게 함).
 */
export interface IRedeemLock {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  storeId: Types.ObjectId;
  terminalId?: Types.ObjectId; // 포스기가 건 잠금. 웹 관리모드 수동 사용이 건 잠금은 없다
  lockedAt: Date;
}

const RedeemLockSchema = new Schema<IRedeemLock>({
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true, unique: true },
  storeId: { type: Schema.Types.ObjectId, ref: "Store", required: true },
  terminalId: { type: Schema.Types.ObjectId, ref: "PosTerminal" },
  lockedAt: { type: Date, default: Date.now, expires: 200 },
});

export default (models.RedeemLock as mongoose.Model<IRedeemLock>) ||
  model<IRedeemLock>("RedeemLock", RedeemLockSchema);
