import "server-only";
import { dbConnect } from "./mongodb";
import PlatformSetting from "./models/PlatformSetting";
import { ApiError } from "./rbac";

// 포인트는 챔프(포스) 결제에서 발생한 적립·사용·취소와 포스 잔액의 서버 이전으로만 바뀐다 — 그 외 임의 변경(웹 관리모드 수동 적립·사용,
// 고객사의 통합포인트 지급·조정)은 포스 잔액과 어긋나 중복·누락을 만들 수 있어 기본으로 꺼 둔다.
// 본사(소유자)가 관리모드의 "임의 포인트 변경 설정"에서 켜고 끈다(DB에 저장, 재시작 불필요).
export const MANUAL_POINTS_KEY = "manualPointChangesEnabled";

let cache: { value: boolean; at: number } | null = null;

export async function isManualPointChangesEnabled(): Promise<boolean> {
  if (cache && Date.now() - cache.at < 3000) return cache.value; // 3초 캐시 — 바꾸면 거의 바로 적용
  await dbConnect();
  const row = await PlatformSetting.findOne({ key: MANUAL_POINTS_KEY }).select("value").lean();
  const value = row?.value === true;
  cache = { value, at: Date.now() };
  return value;
}

export async function setManualPointChangesEnabled(enabled: boolean, actorId: string) {
  await dbConnect();
  await PlatformSetting.updateOne({ key: MANUAL_POINTS_KEY }, { $set: { value: enabled, updatedBy: actorId, updatedAt: new Date() } }, { upsert: true });
  cache = { value: enabled, at: Date.now() };
}

export async function assertManualPointChangesAllowed() {
  if (!(await isManualPointChangesEnabled())) throw new ApiError(403, "MANUAL_POINT_CHANGE_DISABLED");
}
