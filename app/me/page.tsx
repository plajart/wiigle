import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import MeDashboardClient from "./MeDashboardClient";

export default async function MePage() {
  const session = await getSession();
  // 비밀번호를 비워둔 채 처음 들어온 손님은 먼저 비밀번호를 정하게 한다.
  if (session?.pwUnset) redirect("/me/password");
  return <MeDashboardClient />;
}
