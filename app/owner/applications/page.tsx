import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import ApplicationsClient from "./ApplicationsClient";

// 신청 승인은 "새 고객사 + 첫 매장"을 만드는 일이라 운영자(admin) 범위 밖 — 소유자 전용.
export default async function HqApplicationsPage() {
  const session = await getSession();
  if (!session || session.role !== "owner") redirect("/hq");
  return <ApplicationsClient />;
}
