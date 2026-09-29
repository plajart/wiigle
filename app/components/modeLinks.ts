import type { SidebarItem } from "./Sidebar";

export type Mode = "owner" | "hq" | "store" | "me";

/**
 * 용어 체계(계정 role은 그대로 owner / admin / manager / user):
 *   본사(owner, 소유자) > 고객사(admin, 운영자) > 매장(manager, 관리자) > 고객(user)
 * 관리모드 이름도 같다: 본사 관리모드(/owner) · 고객사 관리모드(/hq) · 매장 관리모드(/store) · 고객 모드(/me).
 *
 * 관리모드 전환 링크 — 모든 화면이 같은 라벨·같은 순서(권한이 높은 순: 본사 → 고객사 → 매장 → 고객)로 보여주고,
 * 지금 보고 있는 모드는 뺀다.
 *  - 본사 관리모드: 본사(owner)만
 *  - 고객사 관리모드: 고객사 운영자(admin) / 매장 화면에서 들어온 본사(본사는 본사 대시보드에서 고객사를 골라 들어가는 게
 *    원칙이라, 고객사가 정해지지 않은 화면에서는 링크를 두지 않는다)
 *  - 매장 관리모드: 매장 관리자(manager, 자기 매장)
 *  - 고객 모드: 누구나
 */
export function buildModeLinks(
  session: { role: string; storeManagerOf?: string },
  current: Mode
): SidebarItem[] {
  const links: SidebarItem[] = [];
  if (session.role === "owner" && current !== "owner") links.push({ href: "/owner", label: "본사 관리모드", icon: "★" });
  const hqAllowed = session.role === "admin" || (session.role === "owner" && current === "store");
  if (hqAllowed && current !== "hq") links.push({ href: "/hq", label: "고객사 관리모드", icon: "▤" });
  if (session.role === "manager" && session.storeManagerOf && current !== "store") {
    links.push({ href: "/store", label: "매장 관리모드", icon: "◎" });
  }
  if (current !== "me") links.push({ href: "/me", label: "고객 모드", icon: "○" });
  return links;
}
