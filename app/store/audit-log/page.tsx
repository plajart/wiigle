import { redirect } from "next/navigation";
import { getFreshSession } from "@/lib/session";
import { resolveStoreId } from "@/lib/store-context";
import AuditLogClient from "./AuditLogClient";

export default async function StoreAuditLogPage({ searchParams }: { searchParams: Promise<{ storeId?: string }> }) {
  const session = await getFreshSession();
  if (!session) redirect("/login");
  const { storeId: queryStoreId } = await searchParams;
  const storeId = await resolveStoreId(session, queryStoreId);
  if (!storeId) redirect("/me");
  return <AuditLogClient storeId={storeId} />;
}
