import mongoose, { Schema, models, model, Types } from "mongoose";

export interface IPosTerminal {
  _id: Types.ObjectId;
  storeId: Types.ObjectId;
  name: string;
  apiKey: string;
  status: "ACTIVE" | "REVOKED";
  registeredAt: Date;
  lastSeenAt?: Date;
  initialTransferAt?: Date; // 이 포스기에서 "최초 포인트 서버 이전"이 완료된 시각(서버 기록) — 있으면 이후 이전 때 백업 파일을 만들지 않는다
  agentVersion?: string; // 포스기가 하트비트로 알려준 설치된 프로그램 버전
  agentCaps?: string[]; // 프로그램이 지원하는 기능(예: "update" = 서버 지시 자동 업데이트)
  agentUpdate?: { rolloutId: Types.ObjectId; status: "PENDING" | "UPDATING" | "DONE" | "FAILED" | "MANUAL"; order: number; startedAt?: Date; finishedAt?: Date; skipUntil?: Date; error?: string };
  agentStatus?: { pending: number; skippedNoPhone: number; lastError?: string | null; lastErrorAt?: Date | null; reportedAt: Date };
  isPrimary: boolean; // 매장 내 "대표 포스기" — 이 단말에서만 관리모드 바로가기를 노출. 매장당 1대만 true(지정 시 나머지는 자동 해제)
}

const PosTerminalSchema = new Schema<IPosTerminal>({
  storeId: { type: Schema.Types.ObjectId, ref: "Store", required: true },
  name: { type: String, required: true },
  apiKey: { type: String, required: true, unique: true },
  status: { type: String, enum: ["ACTIVE", "REVOKED"], default: "ACTIVE" },
  registeredAt: { type: Date, default: Date.now },
  lastSeenAt: { type: Date },
  isPrimary: { type: Boolean, default: false },
  // 포스 프로그램이 하트비트에 실어 보내는 진단 정보 — 매장 관리모드에서 "미반영 적립·최근 오류"로 보여준다.
  agentStatus: { type: Schema.Types.Mixed },
  initialTransferAt: { type: Date },
  agentVersion: { type: String },
  agentCaps: { type: [String], default: undefined },
  agentUpdate: { type: Schema.Types.Mixed },
});

// 같은 매장 안에서 사용 중(ACTIVE)인 포스기 이름은 겹치면 안 된다(POS001이 둘이 되는 일 방지). 해지된 포스기는 제외.
// 동시에 두 대가 등록돼도 DB가 막고, 서버는 다음 번호로 다시 시도한다. 기존 중복은 migrate-to-multitenant.ts 7단계가 먼저 정리한다.
PosTerminalSchema.index({ storeId: 1, name: 1 }, { unique: true, partialFilterExpression: { status: "ACTIVE" } });

export default (models.PosTerminal as mongoose.Model<IPosTerminal>) ||
  model<IPosTerminal>("PosTerminal", PosTerminalSchema);
