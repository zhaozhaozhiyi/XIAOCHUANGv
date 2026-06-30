import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { ArrowLeft, CircleHelp, Monitor, Settings2 } from 'lucide-react'

export default function HelpPage() {
  return (
    <div className="page-shell animate-fade-up">
      <div className="mx-auto flex max-w-2xl flex-col gap-5">
        <div className="section-card border-dashed text-center">
          <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-[var(--radius-md)] bg-bg-2 text-text-3">
            <CircleHelp size={28} strokeWidth={1.5} aria-hidden />
          </div>
          <h1 className="page-title mb-2 text-xl">帮助与常见路径</h1>
          <p className="page-subtitle mb-6">
            这个页面不再作为一级模块，只保留为“我的”里的辅助入口，集中说明最常用的创作路径。
          </p>
          <div className="flex flex-col items-stretch gap-2 sm:mx-auto sm:max-w-xs">
            <Button asChild variant="outline" className="rounded-full">
              <Link href="/my">返回我的</Link>
            </Button>
            <Button asChild variant="ghost" className="rounded-full">
              <Link href="/">
                <ArrowLeft size={14} aria-hidden />
                返回创作中心
              </Link>
            </Button>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="section-card">
            <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-text-0">
              <Monitor size={16} aria-hidden />
              常见操作
            </div>
            <p className="text-xs leading-6 text-text-2">
              项目主线从“短剧”进入；快速成片结果在快速成片页内查看；深度制作仍在单集工作台中完成。
            </p>
          </div>
          <div className="section-card">
            <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-text-0">
              <Settings2 size={16} aria-hidden />
              配置排查
            </div>
            <p className="text-xs leading-6 text-text-2">
              如果出现模型不可用、生成失败或配置丢失，优先到设置页检查 AI 服务、Agent 和 Skills 是否完整。
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
