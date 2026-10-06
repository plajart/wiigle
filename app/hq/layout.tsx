import { MANUAL_POINT_CHANGES_ENABLED } from "@/lib/manual-points";
import { redirect } from "next/navigation";
import { getFreshSession } from "@/lib/session";
import { dbConnect } from "@/lib/mongodb";
import { resolveCompanyId } from "@/lib/company-context";
import Company from "@/lib/models/Company";
import Sidebar, { SidebarItem } from "../components/Sidebar";
import { buildModeLinks } from "../components/modeLinks";
import ContextBar from "../components/ContextBar";

// 고객사 관리모드 — 고객사 운영자(admin)는 자기 고객사, 본사(owner)는 본사 대시보드에서 골라 들어온 고객사.
export default async function HqLayout({ children }: { children: React.ReactNode }) {
  const session = await getFreshSession();
  if (!session) redirect("/login?next=/hq");
  if (session.role !== "owner" && session.role !== "admin") redirect("/me");

  // 본사가 고객사를 고르지 않고 들어오면 본사 대시보드(고객사 목록)로 보낸다.
  const companyId = await resolveCompanyId(session);
  if (!companyId && session.role === "owner") redirect("/owner");

  await dbConnect();
  const company = companyId ? await Company.findById(companyId).select("name").lean() : null;
  if (!company && session.role === "owner") redirect("/owner");

  // 업무 흐름 순서: 현황(매장 목록) → 매장 구성(매장·관리자, 벤더 API) → 고객(조회, 통합포인트)
  const items: SidebarItem[] = [
    { href: "/hq", label: "대시보드", icon: "▤" },
    { href: "/hq/stores", label: "매장·관리자", icon: "◈" },
    { href: "/hq/vendor", label: "벤더 API 설정", icon: "⚙" },
    { href: "/hq/customers", label: "고객 조회", icon: "◐" },
  ];
  // 통합포인트 지급·조정은 챔프 외 임의 변경이라 기본으로 숨긴다(ALLOW_MANUAL_POINT_CHANGES=1 일 때만 표시).
  if (MANUAL_POINT_CHANGES_ENABLED) items.push({ href: "/hq/points", label: "통합포인트 관리", icon: "P" });
  const modeLinks = buildModeLinks(session, "hq");

  // 어느 고객사를 관리하는 중인지 상단에 항상 표시한다.
  const bar = company ? (
    <ContextBar
      companyName={company.name}
      note={session.role === "owner" ? "본사가 고객사 운영자 권한으로 관리 중" : "고객사 관리모드"}
      backHref={session.role === "owner" ? "/owner" : undefined}
      backLabel="← 고객사 목록으로"
    />
  ) : (
    <ContextBar companyName="지정되지 않음" note="본사에 고객사 운영자 배정을 요청하세요" warn />
  );

  return (
    <div className="shell">
      <Sidebar items={items} modeLinks={modeLinks} roleLabel="고객사" homeHref="/hq" />
      <div className="shell-content">
        {bar}
        {children}
      </div>
    </div>
  );
}
