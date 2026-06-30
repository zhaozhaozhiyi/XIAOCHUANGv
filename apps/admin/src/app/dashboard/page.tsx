import { backendJson } from "@/lib/backend";

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
      name: "活跃用户",
      value: overview.stats.userCount || 0,
      change: "+12%",
      changeType: "positive" as const,
    },
    {
      name: "短剧总数",
      value: overview.stats.dramaCount || 0,
      change: "+8%",
      changeType: "positive" as const,
    },
    {
      name: "订阅用户",
      value: overview.stats.activeSubscriptionCount || 0,
      change: "+5%",
      changeType: "positive" as const,
    },
  ];

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {stats.map((stat) => (
          <div key={stat.name} className="bg-white rounded-xl shadow-sm p-6 border">
            <p className="text-sm text-slate-500">{stat.name}</p>
            <p className="text-3xl font-bold text-slate-900 mt-2">{stat.value.toLocaleString()}</p>
            <p className={`text-sm mt-2 ${stat.changeType === "positive" ? "text-green-600" : "text-red-600"}`}>
              {stat.change} 较上月
            </p>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-xl shadow-sm border">
        <div className="p-6 border-b">
          <h3 className="text-lg font-semibold text-slate-900">最近注册用户</h3>
        </div>
        <div className="divide-y">
          {overview.recentUsers.length === 0 ? (
            <p className="p-6 text-center text-slate-500">暂无数据</p>
          ) : (
            overview.recentUsers.map((user) => (
              <div key={user.id} className="p-4 flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center">
                    <span className="text-blue-600 font-medium">
                      {user.displayName?.charAt(0) || user.email?.charAt(0) || "U"}
                    </span>
                  </div>
                  <div>
                    <p className="font-medium text-slate-900">{user.displayName}</p>
                    <p className="text-sm text-slate-500">{user.email || user.phone || "-"}</p>
                  </div>
                </div>
                <div className="text-sm text-slate-500">
                  {new Date(user.createdAt).toLocaleDateString("zh-CN")}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
