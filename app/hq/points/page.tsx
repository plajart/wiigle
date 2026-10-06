import { redirect } from "next/navigation";
import { isManualPointChangesEnabled } from "@/lib/manual-points";
import PointsClient from "./PointsClient";

export default async function HqPointsPage() {
  if (!(await isManualPointChangesEnabled())) redirect("/hq"); // 챔프 외 임의 포인트 변경은 막혀 있다
  return <PointsClient />;
}
