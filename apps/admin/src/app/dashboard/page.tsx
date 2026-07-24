import { backendJson } from "@/lib/backend";
import { AdminAvatar, AdminCard, AdminCardHeader, AdminPageHeader, AdminStatCard } from "@/components/admin-kit";

interface OverviewResponse {
  stats: {
    userCount: number;
    dramaCount: number;
    activeSubscriptionCount: number;
  };
  recentUsers: Array<{
    id: number;
    displayName: string;
    email: string | null;
    phone: string | null;
    createdAt: string;
  }>;
}

export default async function DashboardPage() {
  const overview = await backendJson<OverviewResponse>("/api/v1/admin/overview");

  const stats = [
    {
      name: "注册用户",
      value: overview.stats.userCount || 0,
      meta: "当前累计注册用户数",
    },
    {
      name: "短剧总数",
      value: overview.stats.dramaCount || 0,
      meta: "当前累计短剧条目",
    },
    {
      name: "生效订阅",
      value: overview.stats.activeSubscriptionCount || 0,
      meta: "当前处于生效状态的订阅",
    },
  ];

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="平台概览"
        description="聚合查看当前用户规模、内容体量与订阅活跃度。"
      />

      <div className="admin-stat-grid">
        {stats.map((stat) => (
          <AdminStatCard
            key={stat.name}
            label={stat.name}
            value={stat.value.toLocaleString()}
            meta={stat.meta}
          />
        ))}
      </div>

      <AdminCard>
        <AdminCardHeader
          title="最近注册用户"
          description="帮助运营快速感知新增用户的来源与增长节奏。"
        />
        <div className="divide-y divide-[rgba(70,52,41,0.08)]">
          {overview.recentUsers.length === 0 ? (
            <p className="admin-empty">暂无数据</p>
          ) : (
            overview.recentUsers.map((user) => (
              <div key={user.id} className="flex items-center justify-between gap-4 px-6 py-4">
                <div className="flex items-center gap-4">
                  <AdminAvatar label={user.displayName || user.email || "U"} />
                  <div>
                    <p className="admin-cell-main">{user.displayName}</p>
                    <p className="admin-cell-sub">{user.email || user.phone || "-"}</p>
                  </div>
                </div>
                <div className="text-sm text-[color:var(--admin-text-2)]">
                  {new Date(user.createdAt).toLocaleDateString("zh-CN")}
                </div>
              </div>
            ))
          )}
        </div>
      </AdminCard>
    </div>
  );
}
