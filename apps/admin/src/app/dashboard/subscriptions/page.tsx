import { AdminCard, AdminPageHeader, AdminPager, AdminStatCard, AdminTableEmptyRow } from "@/components/admin-kit";
import { SubscriptionStatusChip } from "@/components/admin-status";
import { backendJson } from "@/lib/backend";
import { buildPageHref } from "@/lib/query";

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
  const hasNextPage = response.pagination.page * response.pagination.pageSize < response.pagination.total;

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="订阅管理"
        description="查看套餐结构与用户订阅状态，快速识别活跃和过期订阅。"
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        {plans.map((plan) => (
          <AdminStatCard
            key={plan.id}
            label={plan.displayName}
            value={
              <>
                {plan.price === 0 ? "免费" : `¥${plan.price / 100}`}
                {plan.price > 0 ? <span className="ml-1 text-sm text-[color:var(--admin-text-2)]">/{plan.priceUnit}</span> : null}
              </>
            }
          />
        ))}
      </div>

      <AdminCard>
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>用户ID</th>
                <th>套餐</th>
                <th>状态</th>
                <th>开始时间</th>
                <th>到期时间</th>
              </tr>
            </thead>
            <tbody>
              {allSubscriptions.length === 0 ? (
                <AdminTableEmptyRow
                  colSpan={5}
                  title="当前没有订阅记录"
                  description="新订阅生效后，这里会展示套餐、状态和到期时间。"
                />
              ) : (
                allSubscriptions.map((sub) => (
                  <tr key={sub.id}>
                    <td>
                      <div>
                        <p className="admin-cell-main">{sub.userDisplayName || `用户 #${sub.userId}`}</p>
                        <p className="admin-cell-sub">{sub.userEmail || "-"}</p>
                      </div>
                    </td>
                    <td>
                      <span className="admin-cell-main">{sub.planName}</span>
                    </td>
                    <td>
                      <SubscriptionStatusChip status={sub.status} />
                    </td>
                    <td className="text-[color:var(--admin-text-2)]">
                      {new Date(sub.startedAt).toLocaleDateString("zh-CN")}
                    </td>
                    <td className="text-[color:var(--admin-text-2)]">
                      {sub.expiresAt ? new Date(sub.expiresAt).toLocaleDateString("zh-CN") : "-"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <AdminPager
          totalLabel={`共 ${response.pagination.total} 条记录`}
          previousHref={page > 1 ? buildPageHref(page - 1, { status: params.status }) : null}
          nextHref={hasNextPage ? buildPageHref(page + 1, { status: params.status }) : null}
        />
      </AdminCard>
    </div>
  );
}
