import { redirect } from "next/navigation";
import { getFreshSession } from "@/lib/session";
import Sidebar from "../components/Sidebar";
import { buildModeLinks } from "../components/modeLinks";

// "포인트 이체"(매장↔통합포인트 계좌 사이 옮기기)는 뺐다 — 결제 시 매장→통합포인트→같은 고객사 타매장 순으로
// 자동으로 통합 잔액을 계산해 차감하므로, 손님이 미리 옮겨둘 필요가 없다(2026-09-27 결정).
const ITEMS = [
  { href: "/me", label: "내 포인트", icon: "▤" },
  { href: "/me/history", label: "이용 내역", icon: "≡" },
  { href: "/me/password", label: "비밀번호 변경", icon: "⚿" },
];

// 본사·고객사 운영자·매장 관리자도 기본적으로 회원(고객)이며, 회원은 누구나 고객으로서 포인트를 적립/사용할 수 있다.
// 관리자 권한 유무와 무관하게 로그인한 회원이면 누구나 이 화면에 들어올 수 있다.
// 관리 권한이 있으면(본사·고객사·매장) 그에 따라 관리모드로 들어가는 메뉴가 추가로 제공된다.
export default async function MeLayout({ children }: { children: React.ReactNode }) {
  const session = await getFreshSession();
  if (!session) redirect("/login");

  const modeLinks = buildModeLinks(session, "me");

  return (
    <div className="shell">
      <Sidebar items={ITEMS} modeLinks={modeLinks} roleLabel="고객" homeHref="/me" />
      <div className="shell-content">{children}</div>
    </div>
  );
}
