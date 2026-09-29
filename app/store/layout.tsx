import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { dbConnect } from "@/lib/mongodb";
import { resolveStoreId } from "@/lib/store-context";
import Store from "@/lib/models/Store";
import Company from "@/lib/models/Company";
import Sidebar, { SidebarItem } from "../components/Sidebar";
import ContextBar from "../components/ContextBar";

export default async function StoreLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");
  // manager는 자기 매장 고정, owner/admin은 운영자 화면에서 매장을 골라 들어온 것 — 셋 다
  // 아니면(권한 없는 일반회원 등) 접근 불가.
  if (session.role !== "manager" && session.role !== "owner" && session.role !== "admin") redirect("/me");

  // 현재 매장: manager는 자기 매장, owner/admin은 진입할 때 고른 매장(없으면 매장 목록으로).
  const storeId = await resolveStoreId(session);
  if (!storeId) redirect(session.role === "manager" ? "/me" : session.role === "owner" ? "/owner" : "/hq");
  await dbConnect();
  const store = await Store.findById(storeId).select("name companyId").lean();
  if (!store) redirect(session.role === "manager" ? "/me" : "/hq");
  const company = await Company.findById(store.companyId).select("name").lean();

  const ITEMS: SidebarItem[] = [{ href: "/store", label: "대시보드", icon: "▤" }];
  // 결제 터미널은 실제 매장 계정(manager)으로 로그인해야 쓸 수 있다(운영자·소유자는 결제 화면 불가).
  if (session.role === "manager") ITEMS.push({ href: "/pos", label: "POS 결제 터미널", icon: "◎" });
  ITEMS.push(
    { href: "/store/qr", label: "가입 안내 QR", icon: "▦" },
    { href: "/store/terminals", label: "포스기 다운로드", icon: "⌘" },
    { href: "/store/settlement", label: "일일 정산", icon: "▧" },
    { href: "/store/consent", label: "POS 연동 동의", icon: "⚙" },
    { href: "/store/audit-log", label: "연동 활동 로그", icon: "≡" }
  );

  const modeLinks: SidebarItem[] = [{ href: "/me", label: "회원 모드로", icon: "○" }];
  if (session.role === "owner") modeLinks.push({ href: "/owner", label: "소유자 모드", icon: "★" });
  if (session.role === "owner" || session.role === "admin") modeLinks.push({ href: "/hq", label: "운영자 모드", icon: "▤" });

  const viewer = session.role === "owner" ? "소유자" : session.role === "admin" ? "운영자" : null;

  return (
    <div className="shell">
      <Sidebar items={ITEMS} modeLinks={modeLinks} roleLabel="매장 관리자" homeHref="/store" />
      <div className="shell-content">
        <ContextBar
          companyName={company?.name ?? "(고객사 없음)"}
          storeName={store.name}
          note={viewer ? `${viewer}가 매장 관리자 권한으로 관리 중` : "매장 관리모드"}
          backHref={viewer ? "/hq" : undefined}
          backLabel="← 매장 목록으로"
        />
        {children}
      </div>
    </div>
  );
}
