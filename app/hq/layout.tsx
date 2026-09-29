import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { dbConnect } from "@/lib/mongodb";
import Company from "@/lib/models/Company";
import Sidebar, { SidebarItem } from "../components/Sidebar";
import ContextBar from "../components/ContextBar";

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

  // 어느 고객사를 관리하는 중인지 상단에 항상 표시한다. 운영자는 자기 고객사, 소유자는 전체.
  let bar: React.ReactNode;
  if (session.role === "admin") {
    await dbConnect();
    const company = session.companyAdminOf ? await Company.findById(session.companyAdminOf).select("name").lean() : null;
    bar = company ? (
      <ContextBar companyName={company.name} note="운영자 관리모드" />
    ) : (
      <ContextBar companyName="지정되지 않음" note="소유자에게 고객사 배정을 요청하세요" warn />
    );
  } else {
    bar = <ContextBar companyName="전체 고객사" note="소유자로 모든 고객사를 보는 중" />;
  }

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
