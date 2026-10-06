import { redirect } from "next/navigation";
import { isManualPointChangesEnabled } from "@/lib/manual-points";
import PointsClient from "./PointsClient";

// 임의 포인트 변경 스위치(DB 값)에 따라 달라지므로 빌드 때 미리 만들지 않는다.
export const dynamic = "force-dynamic";

export default async function HqPointsPage() {
  if (!(await isManualPointChangesEnabled())) redirect("/hq"); // 챔프 외 임의 포인트 변경은 막혀 있다
  return <PointsClient />;
}
