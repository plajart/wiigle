import type { SidebarItem } from "./Sidebar";

export type Mode = "owner" | "hq" | "store" | "me";

/**
 * 관리모드 전환 링크 — 모든 화면이 같은 라벨·같은 순서(권한이 높은 순: 소유자 → 본사 → 매장 → 고객)로 보여주고,
 * 지금 보고 있는 모드는 뺀다.
 *  - 소유자 관리모드: 소유자만
 *  - 본사 관리모드: 운영자 / 매장 화면에서 들어온 소유자(소유자는 소유자 대시보드에서 고객사를 골라 들어가는 게 원칙이라
 *    고객사가 정해지지 않은 화면에서는 링크를 두지 않는다)
 *  - 매장 관리모드: 매장 관리자(자기 매장)
 *  - 고객 모드: 누구나
 */
export function buildModeLinks(
  session: { role: string; storeManagerOf?: string },
  current: Mode
): SidebarItem[] {
  const links: SidebarItem[] = [];
  if (session.role === "owner" && current !== "owner") links.push({ href: "/owner", label: "소유자 관리모드", icon: "★" });
  const hqAllowed = session.role === "admin" || (session.role === "owner" && current === "store");
  if (hqAllowed && current !== "hq") links.push({ href: "/hq", label: "본사 관리모드", icon: "▤" });
  if (session.role === "manager" && session.storeManagerOf && current !== "store") {
    links.push({ href: "/store", label: "매장 관리모드", icon: "◎" });
  }
  if (current !== "me") links.push({ href: "/me", label: "고객 모드", icon: "○" });
  return links;
}
