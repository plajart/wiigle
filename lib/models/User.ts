import mongoose, { Schema, models, model, Types } from "mongoose";

export interface IPosLink {
  storeId: Types.ObjectId;
  cardNo: string; // POS(카운터 단말) 회원카드 식별번호
  linkedAt: Date;
}

// 계정 등급 4단계(2026-09-30 도입) — 낮은 등급일수록 좁은 범위:
//   owner   소유자  — 플랫폼 전체(슈퍼유저), 모든 고객사·매장을 넘나들며 관리
//   admin   운영자  — 한 고객사(본사) 범위 — companyAdminOf로 그 회사만
//   manager 관리자  — 한 매장 범위 — storeManagerOf로 그 매장만
//   user    고객    — 등급 없음(기본값), 포인트를 적립/사용하는 일반 회원
export type UserRole = "owner" | "admin" | "manager" | "user";

/**
 * 모든 계정은 기본적으로 하나의 "회원"이다 — 전화번호+비밀번호로 가입하고,
 * 누구나 고객으로서 포인트를 적립/사용할 수 있다. owner/admin/manager 권한은
 * 별도의 계정 종류가 아니라 이 회원 계정에 "얹는" 등급이다(운영자가 동시에
 * 어느 매장에서 포인트를 쓰는 손님일 수도 있는 것처럼).
 */
export interface IUser {
  _id: Types.ObjectId;
  phone: string;
  passwordHash: string;
  // 매장(POS)에서 자동으로 만들어진 손님 계정의 임의 초기 비밀번호 원문 — 손님이 웹에서 처음 로그인할 때 화면에 안내하려고
  // 저장한다. 첫 로그인이 성공하거나 비밀번호를 바꾸면 지운다(그 뒤로는 어디에도 안내하지 않는다). 일반 고객(user)에만 둔다.
  initialPassword?: string;
  // 임시/초기 비밀번호를 받은 계정이 아직 첫 로그인을 하지 않았다는 표시 — 첫 로그인 직후 "비밀번호를 변경하세요" 안내를 한 번만 하려는 것.
  firstLogin?: boolean;
  name: string;
  role: UserRole;
  companyAdminOf?: Types.ObjectId; // role="admin"일 때 — 관리하는 고객사(본사)
  storeManagerOf?: Types.ObjectId; // role="manager"일 때 — 관리하는 매장 (현재는 1인당 1개 매장)
  phoneVerified: boolean;
  otpCode?: string;
  otpExpiresAt?: Date;
  digitalCardNo: string; // 앱 발급 디지털 회원카드번호 — QR로 표시, POS 카드번호 입력란에 그대로 스캔 가능(숫자만)
  posLinks: IPosLink[]; // 매장별 POS 카드번호 연결 — 계산원이 결제 시 전화번호로 고객 확인 후 연결
  referredByStore?: Types.ObjectId; // 매장 고정 QR 스티커로 유입된 경우 기록(집계용, 카드 연결과는 무관)
  createdAt: Date;
}

const UserSchema = new Schema<IUser>({
  phone: { type: String, required: true, unique: true },
  passwordHash: { type: String, required: true },
  initialPassword: { type: String },
  firstLogin: { type: Boolean, default: false },
  name: { type: String, required: true },
  role: { type: String, enum: ["owner", "admin", "manager", "user"], default: "user" },
  companyAdminOf: { type: Schema.Types.ObjectId, ref: "Company" },
  storeManagerOf: { type: Schema.Types.ObjectId, ref: "Store" },
  phoneVerified: { type: Boolean, default: false },
  otpCode: { type: String },
  otpExpiresAt: { type: Date },
  digitalCardNo: { type: String, unique: true, sparse: true },
  referredByStore: { type: Schema.Types.ObjectId, ref: "Store" },
  posLinks: {
    type: [
      {
        storeId: { type: Schema.Types.ObjectId, ref: "Store", required: true },
        cardNo: { type: String, required: true },
        linkedAt: { type: Date, default: Date.now },
      },
    ],
    default: [],
  },
  createdAt: { type: Date, default: Date.now },
});

export default (models.User as mongoose.Model<IUser>) || model<IUser>("User", UserSchema);
