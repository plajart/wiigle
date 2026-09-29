import { redirect } from "next/navigation";
import { getFreshSession } from "@/lib/session";
import Sidebar, { SidebarItem } from "../components/Sidebar";

// 플랫폼 소유자(role=owner) 전용 영역 — 고객사·운영자 계정·고객앱 버전을 관리한다.
export default async function OwnerLayout({ children }: { children: React.ReactNode }) {
  const session = await getFreshSession();
  if (!session) redirect("/login");
  if (session.role !== "owner") redirect("/me");

  const items: SidebarItem[] = [
    { href: "/owner", label: "고객사 관리", icon: "◈" },
    { href: "/owner/admins", label: "본사 운영자 지정", icon: "◐" },
    { href: "/owner/applications", label: "매장 가입 신청", icon: "✓" },
    { href: "/owner/app-releases", label: "고객앱 버전 관리", icon: "⚙" },
  ];
  // 본사·매장 관리모드는 아래 고객사 목록에서 고객사를 골라 들어간다(바로가기 없음).
  const modeLinks: SidebarItem[] = [{ href: "/me", label: "회원 모드로", icon: "○" }];
  if (session.storeManagerOf) modeLinks.push({ href: "/store", label: "매장 관리 모드", icon: "◎" });

  return (
    <div className="shell">
      <Sidebar items={items} modeLinks={modeLinks} roleLabel="소유자" homeHref="/owner" />
      <div className="shell-content">{children}</div>
    </div>
  );
}
