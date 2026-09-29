import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { resolveStoreId } from "@/lib/store-context";
import StoreDashboardClient from "./StoreDashboardClient";

export default async function StorePage({ searchParams }: { searchParams: Promise<{ storeId?: string }> }) {
  const session = await getSession();
  if (!session) redirect("/login");
  const { storeId: queryStoreId } = await searchParams;
  const storeId = await resolveStoreId(session, queryStoreId);
  if (!storeId) redirect("/me");
  return <StoreDashboardClient storeId={storeId} />;
}
