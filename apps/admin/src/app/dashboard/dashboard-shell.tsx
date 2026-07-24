"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Users,
  Film,
  CreditCard,
  LayoutDashboard,
  LogOut,
} from "lucide-react";

const navigation = [
  { name: "仪表盘", href: "/dashboard", icon: LayoutDashboard },
  { name: "用户管理", href: "/dashboard/users", icon: Users },
  { name: "内容管理", href: "/dashboard/dramas", icon: Film },
  { name: "订阅管理", href: "/dashboard/subscriptions", icon: CreditCard },
];

export default function DashboardShell({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const currentLabel = navigation.find((item) => pathname === item.href || (item.href !== "/dashboard" && pathname.startsWith(item.href)))?.name || "仪表盘";

  async function handleLogout() {
    await fetch("/api/admin/logout", { method: "POST" });
    window.location.href = "/login";
  }

  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <div className="admin-sidebar-brand">
          <h1>XIAOCHUANG</h1>
          <p>短剧平台管理后台</p>
        </div>

        <nav className="admin-sidebar-nav">
          {navigation.map((item) => {
            const Icon = item.icon;
            const isActive = pathname === item.href || (item.href !== "/dashboard" && pathname.startsWith(item.href));
            return (
              <Link
                key={item.name}
                href={item.href}
                className="admin-nav-link"
                data-active={isActive ? "true" : "false"}
              >
                <Icon className="w-5 h-5" />
                {item.name}
              </Link>
            );
          })}
        </nav>

        <div className="admin-sidebar-footer">
          <button
            onClick={handleLogout}
            className="admin-logout-button"
          >
            <LogOut className="w-5 h-5" />
            退出登录
          </button>
        </div>
      </aside>

      <main className="admin-main">
        <header className="admin-topbar">
          <div>
            <p className="admin-topbar-eyebrow">Platform Console</p>
            <h2 className="admin-topbar-title">{currentLabel}</h2>
            <p className="admin-topbar-subtitle">统一查看用户、内容与订阅状态。</p>
          </div>
        </header>
        <div className="admin-page">{children}</div>
      </main>
    </div>
  );
}
