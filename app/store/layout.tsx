import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import Sidebar, { SidebarItem } from "../components/Sidebar";

const ITEMS = [
  { href: "/store", label: "대시보드", icon: "▤" },
  { href: "/pos", label: "POS 결제 터미널", icon: "◎" },
  { href: "/store/qr", label: "가입 안내 QR", icon: "▦" },
  { href: "/store/terminals", label: "POS 터미널 등록", icon: "⌘" },
  { href: "/store/settlement", label: "일일 정산", icon: "▧" },
  { href: "/store/consent", label: "POS 연동 동의", icon: "⚙" },
  { href: "/store/audit-log", label: "연동 활동 로그", icon: "≡" },
];

export default async function StoreLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");
  // manager는 자기 매장 고정, owner/admin은 ?storeId=로 특정 매장에 들어온 것 — 셋 다
  // 아니면(권한 없는 일반회원 등) 접근 불가. 실제 매장 선택은 각 페이지가 ?storeId=로 처리.
  if (session.role !== "manager" && session.role !== "owner" && session.role !== "admin") redirect("/me");

  const modeLinks: SidebarItem[] = [{ href: "/me", label: "회원 모드로", icon: "○" }];
  if (session.role === "owner") modeLinks.push({ href: "/owner", label: "소유자 모드", icon: "★" });
  if (session.role === "owner" || session.role === "admin") modeLinks.push({ href: "/hq", label: "운영자 모드", icon: "▤" });

  return (
    <div className="shell">
      <Sidebar items={ITEMS} modeLinks={modeLinks} roleLabel="매장 관리자" homeHref="/store" />
      <div className="shell-content">{children}</div>
    </div>
  );
}
