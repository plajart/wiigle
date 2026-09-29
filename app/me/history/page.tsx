import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import HistoryClient from "./HistoryClient";

export default async function MeHistoryPage() {
  const session = await getSession();
  if (session?.pwUnset) redirect("/me/password");
  return <HistoryClient />;
}
