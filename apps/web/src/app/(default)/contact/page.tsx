import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { ArrowLeft, CircleHelp, Mail, Settings2 } from 'lucide-react'

export default function ContactPage() {
  return (
    <div className="page-shell animate-fade-up">
      <div className="mx-auto flex max-w-2xl flex-col gap-5">
        <div className="section-card border-dashed text-center">
          <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-[var(--radius-md)] bg-bg-2 text-text-3">
            <Mail size={28} strokeWidth={1.5} aria-hidden />
          </div>
          <h1 className="page-title mb-2 text-xl">反馈与联系</h1>
          <p className="page-subtitle mb-6">
            这个页面也作为“我的”的辅助入口保留，用来承接合作、问题反馈和配置排查方向。
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
              <CircleHelp size={16} aria-hidden />
              问题反馈
            </div>
            <p className="text-xs leading-6 text-text-2">
              如需反馈生成失败、页面异常或体验问题，建议附上对应项目、任务或页面路径，方便快速定位。
            </p>
          </div>
          <div className="section-card">
            <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-text-0">
              <Settings2 size={16} aria-hidden />
              配置相关
            </div>
            <p className="text-xs leading-6 text-text-2">
              涉及模型、密钥或 Agent 行为的问题，请先确认设置页中的 AI 服务、Agent 配置和 Skills 是否已保存。
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
