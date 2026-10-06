import { isManualPointChangesEnabled } from "@/lib/manual-points";
import { redirect } from "next/navigation";
import { getFreshSession } from "@/lib/session";
import { dbConnect } from "@/lib/mongodb";
import { resolveStoreId } from "@/lib/store-context";
import Store from "@/lib/models/Store";
import Company from "@/lib/models/Company";
import Sidebar, { SidebarItem } from "../components/Sidebar";
import { buildModeLinks } from "../components/modeLinks";
import ContextBar from "../components/ContextBar";

export default async function StoreLayout({ children }: { children: React.ReactNode }) {
  const session = await getFreshSession();
  if (!session) redirect("/login?next=/store");
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

  // 업무 흐름 순서: 일상 운영(대시보드, 결제, 정산) → 고객 가입 안내 → 연동 설정(동의 → 포스기 설치) → 활동 로그
  const ITEMS: SidebarItem[] = [{ href: "/store", label: "대시보드", icon: "▤" }];
  // 결제 터미널(수동 적립·사용): 매장 관리자, 그리고 매장 관리모드로 들어온 본사·고객사 운영자.
  if ((await isManualPointChangesEnabled()) && (session.role === "manager" || session.role === "owner" || session.role === "admin")) ITEMS.push({ href: "/pos", label: "POS 결제 터미널", icon: "◎" });
  ITEMS.push(
    { href: "/store/settlement", label: "일일 정산", icon: "▧" },
    { href: "/store/qr", label: "가입 안내 QR", icon: "▦" },
    { href: "/store/customers", label: "고객 비밀번호 초기화", icon: "◐" },
    { href: "/store/consent", label: "POS 연동 동의", icon: "⚙" },
    { href: "/store/terminals", label: "포스기 다운로드", icon: "⌘" },
    { href: "/store/audit-log", label: "연동 활동 로그", icon: "≡" }
  );

  const modeLinks = buildModeLinks(session, "store");

  const viewer = session.role === "owner" ? "본사" : session.role === "admin" ? "고객사 운영자" : null;

  return (
    <div className="shell">
      <Sidebar items={ITEMS} modeLinks={modeLinks} roleLabel="매장" homeHref="/store" />
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
