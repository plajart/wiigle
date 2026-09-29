import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";

// 누구나 회원(고객)이 기본이므로 로그인하면 항상 /me로. 본사/매장 관리 모드는
// 거기서 역할에 따라 제공되는 진입 메뉴를 통해 들어간다.
export default async function Home() {
  const session = await getSession();
  if (!session) redirect("/login");
  redirect("/me");
}
