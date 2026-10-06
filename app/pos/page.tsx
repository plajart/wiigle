import { isManualPointChangesEnabled } from "@/lib/manual-points";
import { redirect } from "next/navigation";
import { getFreshSession } from "@/lib/session";
import { resolveStoreId } from "@/lib/store-context";
import PosClient from "./PosClient";

// 임의 포인트 변경 스위치(DB 값)에 따라 달라지므로 빌드 때 미리 만들지 않는다.
export const dynamic = "force-dynamic";

export default async function PosPage() {
  if (!(await isManualPointChangesEnabled())) redirect("/store"); // 웹 수동 적립·사용은 막혀 있다(포인트는 챔프 결제로만 바뀐다)
  const session = await getFreshSession();
  if (!session) redirect("/pos/login");
  // manager는 자기 매장, 소유자·고객사 운영자는 매장 관리모드로 들어가 있는 매장. 그 외는 로그인 화면으로.
  const hasStore = session.role === "owner" || session.role === "admin" ? !!(await resolveStoreId(session)) : !!session.storeManagerOf;
  if (!hasStore) redirect("/pos/login");
  return <PosClient />;
}
