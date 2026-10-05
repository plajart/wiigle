import { redirect } from "next/navigation";
import { getFreshSession } from "@/lib/session";
import Sidebar, { SidebarItem } from "../components/Sidebar";
import { buildModeLinks } from "../components/modeLinks";

// 본사(소유자, role=owner) 전용 영역 — 고객사·고객사 운영자 계정·고객앱 버전을 관리한다.
export default async function OwnerLayout({ children }: { children: React.ReactNode }) {
  const session = await getFreshSession();
  if (!session) redirect("/login?next=/owner");
  if (session.role !== "owner") redirect("/me");

  // 업무 흐름 순서: 고객사 목록(고객사 관리모드 진입) → 새로 들어온 등록 신청 처리 → 고객사 운영자 지정 → 플랫폼 설정
  const items: SidebarItem[] = [
    { href: "/owner", label: "고객사 관리", icon: "◈" },
    { href: "/owner/applications", label: "고객사·매장 등록 신청", icon: "✓" },
    { href: "/owner/admins", label: "고객사 운영자 지정", icon: "◐" },
    { href: "/owner/customer-access", label: "고객 웹 조회 설정", icon: "◉" },
    { href: "/owner/app-releases", label: "고객앱 버전 관리", icon: "⚙" },
  ];
  const modeLinks = buildModeLinks(session, "owner");

  return (
    <div className="shell">
      <Sidebar items={items} modeLinks={modeLinks} roleLabel="본사" homeHref="/owner" />
      <div className="shell-content">{children}</div>
    </div>
  );
}
