import { getSession } from "@/lib/session";
import HqDashboardClient from "./HqDashboardClient";

export default async function HqDashboardPage() {
  const session = await getSession();
  return <HqDashboardClient isOwner={session?.role === "owner"} />;
}
