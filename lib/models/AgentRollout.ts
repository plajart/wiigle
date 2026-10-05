import mongoose, { Schema, models, model, Types } from "mongoose";

// 본사가 시작하는 "모든 고객사·모든 매장 포스 프로그램 순차 업데이트" 한 번의 작업. 서버의 최신 버전(파일 해시)을 목표로 한다.
// 한 번에 한 대씩만 업데이트하도록 currentTerminalId 를 잠금처럼 쓴다(오래 걸리면 시간 초과로 풀린다).
export interface IAgentRollout {
  _id: Types.ObjectId;
  targetVersion: string;
  status: "RUNNING" | "DONE" | "CANCELLED";
  startedBy?: Types.ObjectId;
  startedAt: Date;
  finishedAt?: Date;
  currentTerminalId?: Types.ObjectId | null;
  currentSince?: Date | null;
}

const AgentRolloutSchema = new Schema<IAgentRollout>({
  targetVersion: { type: String, required: true },
  status: { type: String, enum: ["RUNNING", "DONE", "CANCELLED"], default: "RUNNING" },
  startedBy: { type: Schema.Types.ObjectId, ref: "User" },
  startedAt: { type: Date, default: Date.now },
  finishedAt: { type: Date },
  currentTerminalId: { type: Schema.Types.ObjectId, ref: "PosTerminal", default: null },
  currentSince: { type: Date, default: null },
});

export default (models.AgentRollout as mongoose.Model<IAgentRollout>) || model<IAgentRollout>("AgentRollout", AgentRolloutSchema);
