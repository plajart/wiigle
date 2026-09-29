"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

export type SidebarItem = { href: string; label: string; icon: string };

export default function Sidebar({
  items,
  modeLinks,
  roleLabel,
  homeHref,
}: {
  items: SidebarItem[];
  modeLinks?: SidebarItem[]; // 역할에 따라 제공되는 다른 모드로의 진입 메뉴(예: 회원↔본사↔매장)
  roleLabel: string;
  homeHref: string;
}) {
  const pathname = usePathname();
  const router = useRouter();

  async function logout() {
    await fetch("/api/v1/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <nav className="shell-sidebar">
      <Link href={homeHref} className="brand">
        <span className="dot" />
        포인트 관리
        <span className="role-tag">{roleLabel}</span>
      </Link>
      {items.map((item) => {
        const active = pathname === item.href;
        return (
          <Link key={item.href} href={item.href} className={"nav-item" + (active ? " active" : "")}>
            <span className="ic">{item.icon}</span>
            {item.label}
          </Link>
        );
      })}

      <div className="sidebar-bottom">
        {modeLinks && modeLinks.length > 0 && (
          <div className="sidebar-modes">
            <div className="sidebar-modes-label">모드 전환</div>
            {modeLinks.map((item) => (
              <Link key={item.href} href={item.href} className="nav-item mode-link">
                <span className="ic">{item.icon}</span>
                {item.label}
              </Link>
            ))}
          </div>
        )}
        <div className="sidebar-footer">
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              logout();
            }}
          >
            로그아웃
          </a>
        </div>
      </div>
    </nav>
  );
}
