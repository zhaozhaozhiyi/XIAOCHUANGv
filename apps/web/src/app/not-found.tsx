import Link from 'next/link'
import { Clapperboard, ArrowLeft, Mail } from 'lucide-react'

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-bg-page px-6 text-center">
      {/* Brand mark */}
      <div className="mb-8 flex items-center gap-2.5">
        <div className="flex h-9 w-9 items-center justify-center rounded-[12px] bg-accent">
          <Clapperboard size={18} className="text-on-accent" />
        </div>
        <span className="font-display text-base font-semibold tracking-tight text-text-0">小窗 XIAOCHUANG</span>
      </div>

      {/* Code */}
      <p className="font-display text-[96px] font-bold leading-none tracking-tight text-accent/20 select-none">
        404
      </p>

      {/* Message */}
      <h1 className="mt-4 font-display text-2xl font-semibold text-text-0">页面不存在</h1>
      <p className="mt-2 max-w-[320px] text-sm text-text-3 leading-relaxed">
        你访问的页面已被删除或从未存在，可以返回首页继续创作。
      </p>

      {/* Actions */}
      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <Link
          href="/"
          className="inline-flex items-center gap-2 rounded-full bg-accent px-5 py-2.5 text-sm font-medium text-on-accent shadow-primary-glow transition-all hover:bg-accent-dark"
        >
          <ArrowLeft size={14} />
          回到首页
        </Link>
        <Link
          href="/contact"
          className="inline-flex items-center gap-2 rounded-full border border-border bg-bg-0 px-5 py-2.5 text-sm font-medium text-text-1 transition-all hover:bg-bg-hover hover:text-text-0"
        >
          <Mail size={14} />
          联系支持
        </Link>
      </div>
    </div>
  )
}
