import { AdminAvatar, AdminCard, AdminPageHeader, AdminPager, AdminTableEmptyRow } from "@/components/admin-kit";
import { UserRoleChip, UserStatusChip } from "@/components/admin-status";
import { backendJson } from "@/lib/backend";
import { buildPageHref } from "@/lib/query";

interface PageProps {
  searchParams: Promise<{ page?: string; search?: string; status?: string }>;
}

interface UsersResponse {
  items: Array<{
    id: number;
    displayName: string;
    email: string | null;
    phone: string | null;
    role: string;
    status: string;
    createdAt: string;
  }>;
  pagination: {
    page: number;
    pageSize: number;
    total: number;
  };
}

export default async function UsersPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const page = Math.max(1, parseInt(params.page || "1", 10));
  const pageSize = 20;
  const query = new URLSearchParams({
    page: String(page),
    pageSize: String(pageSize),
  });

  if (params.search) query.set("search", params.search);
  if (params.status) query.set("status", params.status);

  const response = await backendJson<UsersResponse>(`/api/v1/admin/users?${query.toString()}`);
  const allUsers = response.items;
  const hasNextPage = response.pagination.page * response.pagination.pageSize < response.pagination.total;

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="用户管理"
        description="按身份、状态与注册时间查看平台全部用户。"
      />

      <AdminCard>
        <div className="admin-toolbar">
          <form className="flex-1" method="get">
            <input
              type="text"
              name="search"
              placeholder="搜索用户名、邮箱或手机号..."
              className="admin-input"
              defaultValue={params.search || ""}
            />
            <select
              name="status"
              className="admin-select"
              defaultValue={params.status || "all"}
            >
              <option value="all">全部状态</option>
              <option value="active">正常</option>
              <option value="disabled">禁用</option>
            </select>
            <button type="submit" className="admin-button admin-button--primary">
              搜索
            </button>
          </form>
        </div>

        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>用户</th>
                <th>角色</th>
                <th>状态</th>
                <th>注册时间</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {allUsers.length === 0 ? (
                <AdminTableEmptyRow
                  colSpan={5}
                  title="还没有用户数据"
                  description="可以先调整筛选条件，或等待新用户注册后再回来查看。"
                />
              ) : (
                allUsers.map((user) => (
                  <tr key={user.id}>
                    <td>
                      <div className="flex items-center gap-3">
                        <AdminAvatar label={user.displayName || "U"} />
                        <div>
                          <p className="admin-cell-main">{user.displayName}</p>
                          <p className="admin-cell-sub">{user.email || user.phone || "-"}</p>
                        </div>
                      </div>
                    </td>
                    <td>
                      <UserRoleChip role={user.role} />
                    </td>
                    <td>
                      <UserStatusChip status={user.status} />
                    </td>
                    <td className="text-sm text-[color:var(--admin-text-2)]">
                      {new Date(user.createdAt).toLocaleDateString("zh-CN")}
                    </td>
                    <td>
                      <a href={`/dashboard/users/${user.id}`} className="admin-link text-sm font-semibold">
                        查看
                      </a>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <AdminPager
          totalLabel={`共 ${response.pagination.total} 条记录`}
          previousHref={page > 1 ? buildPageHref(page - 1, { search: params.search, status: params.status }) : null}
          nextHref={hasNextPage ? buildPageHref(page + 1, { search: params.search, status: params.status }) : null}
        />
      </AdminCard>
    </div>
  );
}
