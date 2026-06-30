import { backendJson } from "@/lib/backend";

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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">用户管理</h1>
          <p className="text-slate-500 mt-1">管理平台所有用户</p>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border">
        <div className="p-4 border-b flex gap-4">
          <form className="flex-1 flex gap-2" method="get">
            <input
              type="text"
              name="search"
              placeholder="搜索用户名、邮箱或手机号..."
              className="flex-1 px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            <select
              name="status"
              className="px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
            >
              <option value="all">全部状态</option>
              <option value="active">正常</option>
              <option value="disabled">禁用</option>
            </select>
            <button
              type="submit"
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              搜索
            </button>
          </form>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase">用户</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase">角色</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase">状态</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase">注册时间</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {allUsers.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-8 text-center text-slate-500">
                    暂无数据
                  </td>
                </tr>
              ) : (
                allUsers.map((user) => (
                  <tr key={user.id} className="hover:bg-slate-50">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center">
                          <span className="text-blue-600 font-medium">
                            {user.displayName?.charAt(0) || "U"}
                          </span>
                        </div>
                        <div>
                          <p className="font-medium text-slate-900">{user.displayName}</p>
                          <p className="text-sm text-slate-500">{user.email || user.phone || "-"}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                        user.role === "super_admin" ? "bg-purple-100 text-purple-700" :
                        user.role === "admin" ? "bg-blue-100 text-blue-700" :
                        "bg-slate-100 text-slate-700"
                      }`}>
                        {user.role === "super_admin" ? "超级管理员" :
                         user.role === "admin" ? "管理员" :
                         user.role === "user" ? "用户" : user.role}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                        user.status === "active" ? "bg-green-100 text-green-700" :
                        user.status === "disabled" ? "bg-red-100 text-red-700" :
                        "bg-slate-100 text-slate-700"
                      }`}>
                        {user.status === "active" ? "正常" :
                         user.status === "disabled" ? "禁用" : user.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm text-slate-500">
                      {new Date(user.createdAt).toLocaleDateString("zh-CN")}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <a
                          href={`/dashboard/users/${user.id}`}
                          className="px-3 py-1 text-sm text-blue-600 hover:bg-blue-50 rounded-lg"
                        >
                          查看
                        </a>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="p-4 border-t flex justify-between items-center">
          <p className="text-sm text-slate-500">
            共 {response.pagination.total} 条记录
          </p>
          <div className="flex gap-2">
            {page > 1 && (
              <a
                href={`?page=${page - 1}`}
                className="px-4 py-2 border rounded-lg hover:bg-slate-50"
              >
                上一页
              </a>
            )}
            <a
              href={`?page=${page + 1}`}
              className="px-4 py-2 border rounded-lg hover:bg-slate-50"
            >
              下一页
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
