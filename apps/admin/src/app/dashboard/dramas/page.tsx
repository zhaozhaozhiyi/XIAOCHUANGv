import { AdminCard, AdminPageHeader, AdminPager, AdminTableEmptyRow } from "@/components/admin-kit";
import { DramaStatusChip, ReviewStatusChip } from "@/components/admin-status";
import { backendJson } from "@/lib/backend";
import { buildPageHref } from "@/lib/query";

interface PageProps {
  searchParams: Promise<{ page?: string; status?: string; genre?: string; search?: string }>;
}

interface DramasResponse {
  items: Array<{
    id: number;
    title: string;
    genre: string | null;
    status: string;
    totalEpisodes: number | null;
    reviewStatus: string | null;
    createdAt: string;
    authorDisplayName: string | null;
  }>;
  pagination: {
    page: number;
    pageSize: number;
    total: number;
  };
}

export default async function DramasPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const page = Math.max(1, parseInt(params.page || "1", 10));
  const pageSize = 20;
  const query = new URLSearchParams({
    page: String(page),
    pageSize: String(pageSize),
  });

  if (params.status) query.set("status", params.status);
  if (params.genre) query.set("genre", params.genre);
  if (params.search) query.set("search", params.search);

  const response = await backendJson<DramasResponse>(`/api/v1/admin/dramas?${query.toString()}`);
  const allDramas = response.items;
  const hasNextPage = response.pagination.page * response.pagination.pageSize < response.pagination.total;

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="内容管理"
        description="查看短剧内容的创作状态、审核流转与作者分布。"
      />

      <AdminCard>
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>标题</th>
                <th>作者</th>
                <th>类型</th>
                <th>状态</th>
                <th>集数</th>
                <th>审核状态</th>
                <th>创建时间</th>
              </tr>
            </thead>
            <tbody>
              {allDramas.length === 0 ? (
                <AdminTableEmptyRow
                  colSpan={7}
                  title="当前没有短剧内容"
                  description="新建短剧或完成导入后，这里会显示标题、审核状态和作者信息。"
                />
              ) : (
                allDramas.map((drama) => (
                  <tr key={drama.id}>
                    <td>
                      <div>
                        <p className="admin-cell-main">{drama.title}</p>
                        {drama.genre ? <p className="admin-cell-sub">{drama.genre}</p> : null}
                      </div>
                    </td>
                    <td className="text-[color:var(--admin-text-2)]">{drama.authorDisplayName || "-"}</td>
                    <td className="text-[color:var(--admin-text-2)]">{drama.genre || "-"}</td>
                    <td>
                      <DramaStatusChip status={drama.status} />
                    </td>
                    <td className="text-[color:var(--admin-text-2)]">{drama.totalEpisodes || 0}</td>
                    <td>
                      <ReviewStatusChip status={drama.reviewStatus} />
                    </td>
                    <td className="text-[color:var(--admin-text-2)]">
                      {new Date(drama.createdAt).toLocaleDateString("zh-CN")}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <AdminPager
          totalLabel={`共 ${response.pagination.total} 条记录`}
          previousHref={page > 1 ? buildPageHref(page - 1, { status: params.status, genre: params.genre, search: params.search }) : null}
          nextHref={hasNextPage ? buildPageHref(page + 1, { status: params.status, genre: params.genre, search: params.search }) : null}
        />
      </AdminCard>
    </div>
  );
}
