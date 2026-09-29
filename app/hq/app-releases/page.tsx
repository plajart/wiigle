import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import AppReleasesClient from "./AppReleasesClient";

export default async function AppReleasesPage() {
  const session = await getSession();
  if (!session || !session.isHqAdmin) redirect("/me");
  return <AppReleasesClient />;
}
