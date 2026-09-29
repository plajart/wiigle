import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import Sidebar, { SidebarItem } from "../components/Sidebar";

export default async function HqLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "owner" && session.role !== "admin") redirect("/me");

  const items: SidebarItem[] = [{ href: "/hq", label: "대시보드", icon: "▤" }];
  if (session.role === "owner") items.push({ href: "/hq/applications", label: "매장 가입 신청", icon: "✓" });
  items.push(
    { href: "/hq/stores", label: "매장 생성", icon: "◈" },
    { href: "/hq/customers", label: "고객 조회", icon: "◐" },
    { href: "/hq/vendor", label: "벤더 API 설정", icon: "⚙" },
    { href: "/hq/points", label: "포인트 관리", icon: "P" }
  );

  const modeLinks: SidebarItem[] = [{ href: "/me", label: "회원 모드로", icon: "○" }];
  if (session.role === "owner") modeLinks.push({ href: "/owner", label: "소유자 모드로", icon: "★" });
  if (session.storeManagerOf) modeLinks.push({ href: "/store", label: "매장 관리 모드", icon: "◎" });

  return (
    <div className="shell">
      <Sidebar items={items} modeLinks={modeLinks} roleLabel="운영자" homeHref="/hq" />
      <div className="shell-content">{children}</div>
    </div>
  );
}
