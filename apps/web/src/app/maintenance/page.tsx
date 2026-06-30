import { Clapperboard, Wrench } from 'lucide-react'

export default function MaintenancePage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-bg-page px-6 text-center">
      {/* Brand mark */}
      <div className="mb-8 flex items-center gap-2.5">
        <div className="flex h-9 w-9 items-center justify-center rounded-[12px] bg-accent">
          <Clapperboard size={18} className="text-on-accent" />
        </div>
        <span className="font-display text-base font-semibold tracking-tight text-text-0">小窗 XIAOCHUANG</span>
      </div>

      {/* Icon */}
      <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-[24px] bg-accent-bg">
        <Wrench size={36} className="text-accent" />
      </div>

      {/* Badge */}
      <span className="mb-4 inline-flex items-center gap-1.5 rounded-full bg-warning-bg px-3 py-1 text-xs font-medium text-warning">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-warning" />
        维护中
      </span>

      {/* Message */}
      <h1 className="font-display text-2xl font-semibold text-text-0">系统维护中</h1>
      <p className="mt-2 max-w-[340px] text-sm text-text-3 leading-relaxed">
        小窗正在进行系统维护，预计很快恢复。感谢你的耐心等待。
      </p>

      <p className="mt-6 text-xs text-text-3/60">
        如有紧急问题，请联系{' '}
        <a href="/contact" className="text-accent underline-offset-2 hover:underline">
          在线支持
        </a>
      </p>
    </div>
  )
}
