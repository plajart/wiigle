import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import Sidebar, { SidebarItem } from "../components/Sidebar";

// 플랫폼 소유자(role=owner) 전용 영역 — 고객사·운영자 계정·고객앱 버전을 관리한다.
export default async function OwnerLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "owner") redirect("/me");

  const items: SidebarItem[] = [
    { href: "/owner", label: "고객사 관리", icon: "◈" },
    { href: "/owner/admins", label: "운영자 배정", icon: "◐" },
    { href: "/hq/applications", label: "매장 가입 신청", icon: "✓" },
    { href: "/owner/app-releases", label: "고객앱 버전 관리", icon: "⚙" },
  ];
  const modeLinks: SidebarItem[] = [
    { href: "/me", label: "회원 모드로", icon: "○" },
    { href: "/hq", label: "운영자 모드", icon: "▤" },
  ];
  if (session.storeManagerOf) modeLinks.push({ href: "/store", label: "매장 관리 모드", icon: "◎" });

  return (
    <div className="shell">
      <Sidebar items={items} modeLinks={modeLinks} roleLabel="소유자" homeHref="/owner" />
      <div className="shell-content">{children}</div>
    </div>
  );
}
