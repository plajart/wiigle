import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { resolveStoreId } from "@/lib/store-context";
import SettlementClient from "./SettlementClient";

export default async function StoreSettlementPage({ searchParams }: { searchParams: Promise<{ storeId?: string }> }) {
  const session = await getSession();
  if (!session) redirect("/login");
  const { storeId: queryStoreId } = await searchParams;
  const storeId = await resolveStoreId(session, queryStoreId);
  if (!storeId) redirect("/me");
  return <SettlementClient storeId={storeId} />;
}
