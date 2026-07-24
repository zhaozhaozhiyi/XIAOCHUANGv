import Link from "next/link";
import {
  AdminCard,
  AdminCardBody,
  AdminCardHeader,
  AdminKeyValue,
  AdminPageHeader,
  AdminTableEmptyRow,
} from "@/components/admin-kit";
import {
  DramaStatusChip,
  SubscriptionStatusChip,
  UserRoleChip,
  UserStatusChip,
} from "@/components/admin-status";
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
      <div className="admin-empty">
        <p className="admin-empty-title">无效的用户 ID</p>
        <p className="admin-empty-description">请返回列表重新选择一个有效用户。</p>
        <Link href="/dashboard/users" className="admin-link mt-4 inline-block font-semibold">
          返回用户列表
        </Link>
      </div>
    );
  }

  const data = await backendJson<UserDetailResponse>(`/api/v1/admin/users/${userId}`);
  if (data.error === "user_not_found") {
    return (
      <div className="admin-empty">
        <p className="admin-empty-title">用户不存在</p>
        <p className="admin-empty-description">这个用户可能已被删除，或当前链接已经失效。</p>
        <Link href="/dashboard/users" className="admin-link mt-4 inline-block font-semibold">
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
      <AdminPageHeader
        backHref="/dashboard/users"
        backLabel="← 返回用户列表"
        title="用户详情"
        description="查看该用户的账号信息、订阅状态与创作内容。"
      />

      <div className="admin-detail-grid">
        <AdminCard>
          <AdminCardHeader title="基本信息" />
          <AdminCardBody className="admin-detail-list">
            <AdminKeyValue label="用户ID" value={user.id} />
            <AdminKeyValue label="显示名称" value={user.displayName} />
            <AdminKeyValue label="邮箱" value={user.email || "-"} />
            <AdminKeyValue label="手机号" value={user.phone || "-"} />
            <AdminKeyValue label="账号类型" value={user.accountType} />
            <AdminKeyValue label="角色" value={<UserRoleChip role={user.role} />} />
            <AdminKeyValue label="状态" value={<UserStatusChip status={user.status} />} />
            <AdminKeyValue label="注册时间" value={new Date(user.createdAt).toLocaleString("zh-CN")} />
          </AdminCardBody>
        </AdminCard>

        <AdminCard>
          <AdminCardHeader title="订阅信息" />
          <AdminCardBody className="admin-detail-list">
            {userSubscription ? (
              <>
                <AdminKeyValue label="当前套餐" value={userSubscription.planName} />
                <AdminKeyValue label="状态" value={<SubscriptionStatusChip status={userSubscription.status} />} />
                <AdminKeyValue label="开始时间" value={new Date(userSubscription.startedAt).toLocaleDateString("zh-CN")} />
                {userSubscription.expiresAt ? (
                  <AdminKeyValue label="到期时间" value={new Date(userSubscription.expiresAt).toLocaleDateString("zh-CN")} />
                ) : null}
              </>
            ) : (
              <p className="text-[color:var(--admin-text-2)]">暂无订阅</p>
            )}
          </AdminCardBody>
        </AdminCard>

        <AdminCard>
          <AdminCardHeader title="组织信息" />
          <AdminCardBody className="admin-detail-list">
            <AdminKeyValue label="组织名称" value={data.organization?.name || `${user.displayName} 的组织`} />
            <AdminKeyValue label="套餐" value={data.organization?.plan || "free"} />
          </AdminCardBody>
        </AdminCard>
      </div>

      <AdminCard>
        <AdminCardHeader
          title="创建的短剧"
          description="查看该用户当前创建的短剧数量与进度状态。"
        />
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>标题</th>
                <th>状态</th>
                <th>集数</th>
                <th>创建时间</th>
              </tr>
            </thead>
            <tbody>
              {userDramas.length === 0 ? (
                <AdminTableEmptyRow
                  colSpan={4}
                  title="这个用户还没有创建短剧"
                  description="当用户开始创作后，这里会展示对应的短剧条目与状态。"
                />
              ) : (
                userDramas.map((drama) => (
                  <tr key={drama.id}>
                    <td>
                      <p className="admin-cell-main font-semibold">{drama.title}</p>
                    </td>
                    <td>
                      <DramaStatusChip status={drama.status} />
                    </td>
                    <td className="text-[color:var(--admin-text-2)]">{drama.totalEpisodes || 0}</td>
                    <td className="text-[color:var(--admin-text-2)]">
                      {new Date(drama.createdAt).toLocaleDateString("zh-CN")}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </AdminCard>
    </div>
  );
}
