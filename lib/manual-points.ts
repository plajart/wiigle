import "server-only";
import { ApiError } from "./rbac";

// 포인트는 챔프(포스) 결제에서 발생한 적립·사용·취소와 포스 잔액의 서버 이전으로만 바뀐다 — 그 외 임의 변경(웹 관리모드 수동 적립·사용,
// 고객사의 통합포인트 지급·조정)은 포스 잔액과 어긋나 중복·누락을 만들 수 있어 기본으로 막아 둔다.
// 정말 필요한 비상 정정 때만 서버 환경변수 ALLOW_MANUAL_POINT_CHANGES=1 로 다시 켠다(켜고 재시작, 끝나면 끈다).
export const MANUAL_POINT_CHANGES_ENABLED = process.env.ALLOW_MANUAL_POINT_CHANGES === "1";

export function assertManualPointChangesAllowed() {
  if (!MANUAL_POINT_CHANGES_ENABLED) throw new ApiError(403, "MANUAL_POINT_CHANGE_DISABLED");
}
