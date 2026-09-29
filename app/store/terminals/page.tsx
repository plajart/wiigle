import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { resolveStoreId } from "@/lib/store-context";
import TerminalsClient from "./TerminalsClient";

export default async function StoreTerminalsPage({ searchParams }: { searchParams: Promise<{ storeId?: string }> }) {
  const session = await getSession();
  if (!session) redirect("/login");
  const { storeId: queryStoreId } = await searchParams;
  const storeId = await resolveStoreId(session, queryStoreId);
  if (!storeId) redirect("/me");
  return <TerminalsClient storeId={storeId} />;
}
