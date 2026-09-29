import { getSession } from "@/lib/session";
import StoresClient from "./StoresClient";

export default async function HqStoresPage() {
  const session = await getSession();
  return <StoresClient isOwner={session?.role === "owner"} />;
}
