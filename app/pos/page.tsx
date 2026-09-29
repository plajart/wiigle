import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import PosClient from "./PosClient";

export default async function PosPage() {
  const session = await getSession();
  if (!session || !session.storeManagerOf) redirect("/pos/login");
  return <PosClient />;
}
