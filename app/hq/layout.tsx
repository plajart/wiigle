import { redirect } from "next/navigation";
import { getFreshSession } from "@/lib/session";
import { dbConnect } from "@/lib/mongodb";
import { resolveCompanyId } from "@/lib/company-context";
import Company from "@/lib/models/Company";
import Sidebar, { SidebarItem } from "../components/Sidebar";
import ContextBar from "../components/ContextBar";

// 본사(고객사) 관리모드 — 운영자는 자기 고객사, 소유자는 소유자 대시보드에서 골라 들어온 고객사.
export default async function HqLayout({ children }: { children: React.ReactNode }) {
  const session = await getFreshSession();
  if (!session) redirect("/login");
  if (session.role !== "owner" && session.role !== "admin") redirect("/me");

  // 소유자가 고객사를 고르지 않고 들어오면 소유자 대시보드(고객사 목록)로 보낸다.
  const companyId = await resolveCompanyId(session);
  if (!companyId && session.role === "owner") redirect("/owner");

  await dbConnect();
  const company = companyId ? await Company.findById(companyId).select("name").lean() : null;
  if (!company && session.role === "owner") redirect("/owner");

  const items: SidebarItem[] = [
    { href: "/hq", label: "대시보드", icon: "▤" },
    { href: "/hq/stores", label: "매장·관리자", icon: "◈" },
    { href: "/hq/customers", label: "고객 조회", icon: "◐" },
    { href: "/hq/vendor", label: "벤더 API 설정", icon: "⚙" },
    { href: "/hq/points", label: "통합포인트 관리", icon: "P" },
  ];

  const modeLinks: SidebarItem[] = [{ href: "/me", label: "회원 모드로", icon: "○" }];
  if (session.role === "owner") modeLinks.push({ href: "/owner", label: "소유자 모드로", icon: "★" });
  if (session.storeManagerOf) modeLinks.push({ href: "/store", label: "매장 관리 모드", icon: "◎" });

  // 어느 고객사를 관리하는 중인지 상단에 항상 표시한다.
  const bar = company ? (
    <ContextBar
      companyName={company.name}
      note={session.role === "owner" ? "소유자가 운영자 권한으로 관리 중" : "운영자 관리모드"}
      backHref={session.role === "owner" ? "/owner" : undefined}
      backLabel="← 고객사 목록으로"
    />
  ) : (
    <ContextBar companyName="지정되지 않음" note="소유자에게 고객사 배정을 요청하세요" warn />
  );

  return (
    <div className="shell">
      <Sidebar items={items} modeLinks={modeLinks} roleLabel="운영자" homeHref="/hq" />
      <div className="shell-content">
        {bar}
        {children}
      </div>
    </div>
  );
}
