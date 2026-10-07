import "server-only";
import { dbConnect } from "./mongodb";
import PlatformSetting from "./models/PlatformSetting";

// 본사 "운영 점검·복구"의 긴급 스위치. 포스 프로그램은 30초마다 하트비트로 이 값을 받아 따른다(재시작 불필요).
// - autoInjectAllowed(기본 허용): 끄면 모든 포스기의 "고객 조회 시 통합포인트 자동 반영"이 멈춘다(이미 반영 중인 값은 시간이 지나면 정리).
// - redeemPaused(기본 아님): 켜면 서버가 포인트 사용 조회를 거부한다(적립은 계속). 문제가 발견돼 사용만 잠시 멈추고 점검할 때.
export const OPS_AUTO_INJECT_KEY = "opsAutoInjectAllowed";
export const OPS_REDEEM_PAUSED_KEY = "opsRedeemPaused";

export type OpsSwitches = { autoInjectAllowed: boolean; redeemPaused: boolean };

let cache: { value: OpsSwitches; at: number } | null = null;

export async function getOpsSwitches(): Promise<OpsSwitches> {
  if (cache && Date.now() - cache.at < 3000) return cache.value; // 3초 캐시 — 바꾸면 거의 바로 적용
  await dbConnect();
  const rows = await PlatformSetting.find({ key: { $in: [OPS_AUTO_INJECT_KEY, OPS_REDEEM_PAUSED_KEY] } }).select("key value").lean();
  const get = (k: string) => rows.find((r) => r.key === k)?.value;
  const value: OpsSwitches = { autoInjectAllowed: get(OPS_AUTO_INJECT_KEY) !== false, redeemPaused: get(OPS_REDEEM_PAUSED_KEY) === true };
  cache = { value, at: Date.now() };
  return value;
}

export async function setOpsSwitch(name: keyof OpsSwitches, value: boolean, actorId: string) {
  await dbConnect();
  const key = name === "autoInjectAllowed" ? OPS_AUTO_INJECT_KEY : OPS_REDEEM_PAUSED_KEY;
  await PlatformSetting.updateOne({ key }, { $set: { value, updatedBy: actorId, updatedAt: new Date() } }, { upsert: true });
  cache = null;
}
