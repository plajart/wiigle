import { redirect } from "next/navigation";
import { MANUAL_POINT_CHANGES_ENABLED } from "@/lib/manual-points";
import PointsClient from "./PointsClient";

export default function HqPointsPage() {
  if (!MANUAL_POINT_CHANGES_ENABLED) redirect("/hq"); // 챔프 외 임의 포인트 변경은 막혀 있다
  return <PointsClient />;
}
