import { backendJson } from "@/lib/backend";

interface PageProps {
  searchParams: Promise<{ page?: string; status?: string }>;
}

interface SubscriptionsResponse {
  items: Array<{
    id: number;
    userId: number;
    userDisplayName: string | null;
    userEmail: string | null;
    planName: string;
    status: string;
    startedAt: string;
    expiresAt: string | null;
  }>;
  plans: Array<{
    id: number;
    name: string;
    displayName: string;
    price: number;
    priceUnit: string;
  }>;
  pagination: {
    page: number;
    pageSize: number;
    total: number;
  };
}

export default async function SubscriptionsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const page = Math.max(1, parseInt(params.page || "1", 10));
  const pageSize = 20;
  const query = new URLSearchParams({
    page: String(page),
    pageSize: String(pageSize),
  });

  if (params.status) query.set("status", params.status);

  const response = await backendJson<SubscriptionsResponse>(`/api/v1/admin/subscriptions?${query.toString()}`);
  const allSubscriptions = response.items;
  const plans = response.plans;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">订阅管理</h1>
          <p className="text-slate-500 mt-1">管理用户订阅和套餐</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {plans.map((plan) => (
          <div key={plan.id} className="bg-white rounded-xl shadow-sm border p-4">
            <h3 className="font-semibold text-slate-900">{plan.displayName}</h3>
            <p className="text-2xl font-bold text-blue-600 mt-2">
              {plan.price === 0 ? "免费" : `¥${plan.price / 100}`}
              {plan.price > 0 && <span className="text-sm text-slate-500">/{plan.priceUnit}</span>}
            </p>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-xl shadow-sm border">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase">用户ID</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase">套餐</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase">状态</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase">开始时间</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase">到期时间</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {allSubscriptions.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-8 text-center text-slate-500">
                    暂无数据
                  </td>
                </tr>
              ) : (
                allSubscriptions.map((sub) => (
                  <tr key={sub.id} className="hover:bg-slate-50">
                    <td className="px-6 py-4">
                      <div>
                        <p className="font-medium text-slate-900">{sub.userDisplayName || `用户 #${sub.userId}`}</p>
                        <p className="text-sm text-slate-500">{sub.userEmail || "-"}</p>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className="font-medium text-slate-900">{sub.planName}</span>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                        sub.status === "active" ? "bg-green-100 text-green-700" :
                        sub.status === "cancelled" ? "bg-red-100 text-red-700" :
                        sub.status === "expired" ? "bg-yellow-100 text-yellow-700" :
                        "bg-slate-100 text-slate-700"
                      }`}>
                        {sub.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-slate-500">
                      {new Date(sub.startedAt).toLocaleDateString("zh-CN")}
                    </td>
                    <td className="px-6 py-4 text-slate-500">
                      {sub.expiresAt ? new Date(sub.expiresAt).toLocaleDateString("zh-CN") : "-"}
                    </td>
                    <td className="px-6 py-4">
                      <a
                        href={`/dashboard/subscriptions/${sub.id}`}
                        className="px-3 py-1 text-sm text-blue-600 hover:bg-blue-50 rounded-lg"
                      >
                        查看
                      </a>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
