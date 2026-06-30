import { backendJson } from "@/lib/backend";

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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">内容管理</h1>
          <p className="text-slate-500 mt-1">管理所有短剧内容</p>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase">标题</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase">作者</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase">类型</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase">状态</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase">集数</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase">审核状态</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase">创建时间</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {allDramas.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-6 py-8 text-center text-slate-500">
                    暂无数据
                  </td>
                </tr>
              ) : (
                allDramas.map((drama) => (
                  <tr key={drama.id} className="hover:bg-slate-50">
                    <td className="px-6 py-4">
                      <div>
                        <p className="font-medium text-slate-900">{drama.title}</p>
                        {drama.genre && (
                          <p className="text-sm text-slate-500">{drama.genre}</p>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-slate-500">{drama.authorDisplayName || "-"}</td>
                    <td className="px-6 py-4 text-slate-500">{drama.genre || "-"}</td>
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
                    <td className="px-6 py-4">
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                        drama.reviewStatus === "approved" ? "bg-green-100 text-green-700" :
                        drama.reviewStatus === "rejected" ? "bg-red-100 text-red-700" :
                        drama.reviewStatus === "pending" ? "bg-yellow-100 text-yellow-700" :
                        "bg-slate-100 text-slate-700"
                      }`}>
                        {drama.reviewStatus || "pending"}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-slate-500">
                      {new Date(drama.createdAt).toLocaleDateString("zh-CN")}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <a
                          href={`/dashboard/dramas/${drama.id}`}
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
      </div>
    </div>
  );
}
