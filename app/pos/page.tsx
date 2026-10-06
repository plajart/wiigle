import { redirect } from "next/navigation";
import { getFreshSession } from "@/lib/session";
import { resolveStoreId } from "@/lib/store-context";
import PosClient from "./PosClient";

export default async function PosPage() {
  const session = await getFreshSession();
  if (!session) redirect("/pos/login");
  // manager는 자기 매장, 소유자·고객사 운영자는 매장 관리모드로 들어가 있는 매장. 그 외는 로그인 화면으로.
  const hasStore = session.role === "owner" || session.role === "admin" ? !!(await resolveStoreId(session)) : !!session.storeManagerOf;
  if (!hasStore) redirect("/pos/login");
  return <PosClient />;
}
