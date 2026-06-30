import Link from "next/link";
import { backendJson } from "@/lib/backend";

interface PageProps {
  params: Promise<{ id: string }>;
}

interface UserDetailResponse {
  error?: string;
  user: {
    id: number;
    displayName: string;
    email: string | null;
    phone: string | null;
    accountType: string;
    role: string;
    status: string;
    createdAt: string;
  };
  subscription: null | {
    id: number;
    planName: string;
    status: string;
    startedAt: string;
    expiresAt: string | null;
  };
  organization: null | {
    id: number;
    name: string;
    plan: string;
  };
  dramas: Array<{
    id: number;
    title: string;
    status: string;
    totalEpisodes: number | null;
    createdAt: string;
  }>;
}

export default async function UserDetailPage({ params }: PageProps) {
  const { id } = await params;
  const userId = parseInt(id, 10);

  if (isNaN(userId)) {
    return (
      <div className="text-center py-12">
        <p className="text-slate-500">无效的用户ID</p>
        <Link href="/dashboard/users" className="text-blue-600 hover:underline mt-4 inline-block">
          返回用户列表
        </Link>
      </div>
    );
  }

  const data = await backendJson<UserDetailResponse>(`/api/v1/admin/users/${userId}`);
  if (data.error === "user_not_found") {
    return (
      <div className="text-center py-12">
        <p className="text-slate-500">用户不存在</p>
        <Link href="/dashboard/users" className="text-blue-600 hover:underline mt-4 inline-block">
          返回用户列表
        </Link>
      </div>
    );
  }
  const user = data.user;
  const userSubscription = data.subscription;
  const userDramas = data.dramas;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/dashboard/users" className="text-sm text-slate-500 hover:text-slate-700">
            ← 返回用户列表
          </Link>
          <h1 className="text-2xl font-bold text-slate-900 mt-2">用户详情</h1>
        </div>
        <div className="flex gap-2">
          <Link
            href={`/dashboard/users/${userId}/edit`}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            编辑用户
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="bg-white rounded-xl shadow-sm border p-6">
          <h2 className="text-lg font-semibold text-slate-900 mb-4">基本信息</h2>
          <div className="space-y-4">
            <div>
              <p className="text-sm text-slate-500">用户ID</p>
              <p className="font-medium">{user.id}</p>
            </div>
            <div>
              <p className="text-sm text-slate-500">显示名称</p>
              <p className="font-medium">{user.displayName}</p>
            </div>
            <div>
              <p className="text-sm text-slate-500">邮箱</p>
              <p className="font-medium">{user.email || "-"}</p>
            </div>
            <div>
              <p className="text-sm text-slate-500">手机号</p>
              <p className="font-medium">{user.phone || "-"}</p>
            </div>
            <div>
              <p className="text-sm text-slate-500">账号类型</p>
              <p className="font-medium">{user.accountType}</p>
            </div>
            <div>
              <p className="text-sm text-slate-500">角色</p>
              <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                user.role === "super_admin" ? "bg-purple-100 text-purple-700" :
                user.role === "admin" ? "bg-blue-100 text-blue-700" :
                "bg-slate-100 text-slate-700"
              }`}>
                {user.role}
              </span>
            </div>
            <div>
              <p className="text-sm text-slate-500">状态</p>
              <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                user.status === "active" ? "bg-green-100 text-green-700" :
                "bg-red-100 text-red-700"
              }`}>
                {user.status}
              </span>
            </div>
            <div>
              <p className="text-sm text-slate-500">注册时间</p>
              <p className="font-medium">{new Date(user.createdAt).toLocaleString("zh-CN")}</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm border p-6">
          <h2 className="text-lg font-semibold text-slate-900 mb-4">订阅信息</h2>
          {userSubscription ? (
            <div className="space-y-4">
              <div>
                <p className="text-sm text-slate-500">当前套餐</p>
                <p className="font-medium">{userSubscription.planName}</p>
              </div>
              <div>
                <p className="text-sm text-slate-500">状态</p>
                <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                  userSubscription.status === "active" ? "bg-green-100 text-green-700" :
                  userSubscription.status === "cancelled" ? "bg-red-100 text-red-700" :
                  "bg-slate-100 text-slate-700"
                }`}>
                  {userSubscription.status}
                </span>
              </div>
              <div>
                <p className="text-sm text-slate-500">开始时间</p>
                <p className="font-medium">{new Date(userSubscription.startedAt).toLocaleDateString("zh-CN")}</p>
              </div>
              {userSubscription.expiresAt && (
                <div>
                  <p className="text-sm text-slate-500">到期时间</p>
                  <p className="font-medium">{new Date(userSubscription.expiresAt).toLocaleDateString("zh-CN")}</p>
                </div>
              )}
            </div>
          ) : (
            <p className="text-slate-500">暂无订阅</p>
          )}
        </div>

        <div className="bg-white rounded-xl shadow-sm border p-6">
          <h2 className="text-lg font-semibold text-slate-900 mb-4">组织信息</h2>
          <div className="space-y-4">
            <div>
              <p className="text-sm text-slate-500">组织名称</p>
              <p className="font-medium">{data.organization?.name || `${user.displayName} 的组织`}</p>
            </div>
            <div>
              <p className="text-sm text-slate-500">套餐</p>
              <p className="font-medium">{data.organization?.plan || "free"}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border">
        <div className="p-6 border-b">
          <h2 className="text-lg font-semibold text-slate-900">创建的短剧</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase">标题</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase">状态</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase">集数</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase">创建时间</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {userDramas.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-6 py-8 text-center text-slate-500">
                    暂无短剧
                  </td>
                </tr>
              ) : (
                userDramas.map((drama) => (
                  <tr key={drama.id} className="hover:bg-slate-50">
                    <td className="px-6 py-4">
                      <Link href={`/dashboard/dramas/${drama.id}`} className="font-medium text-slate-900 hover:text-blue-600">
                        {drama.title}
                      </Link>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                        drama.status === "published" ? "bg-green-100 text-green-700" :
                        drama.status === "draft" ? "bg-slate-100 text-slate-700" :
                        "bg-yellow-100 text-yellow-700"
                      }`}>
                        {drama.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-slate-500">{drama.totalEpisodes || 0}</td>
                    <td className="px-6 py-4 text-slate-500">
                      {new Date(drama.createdAt).toLocaleDateString("zh-CN")}
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
