import Image from 'next/image'
import Link from 'next/link'

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-bg-page text-text-1">
      <header className="border-b border-border/70 bg-bg-page/95">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5 sm:px-10">
          <Link href="/" className="inline-flex items-center gap-3 text-text-0">
            <span className="relative flex h-9 w-9 items-center justify-center overflow-hidden rounded-[12px] border border-border/70 bg-brand-mark shadow-[0_4px_12px_rgba(40,28,18,0.08)]">
              <Image src="/window.svg" alt="小窗 Logo" fill sizes="24px" className="scale-[0.68] object-contain" />
            </span>
            <span className="flex flex-col leading-none">
              <span className="text-[1.1rem] font-semibold tracking-[-0.012em]" style={{ fontFamily: '"Iowan Old Style", Georgia, serif' }}>
                小窗
              </span>
              <span className="mt-1 text-[0.65rem] font-medium uppercase tracking-[0.18em] text-text-2">XIAOCHUANG</span>
            </span>
          </Link>
          <Link href="/login" className="text-sm text-text-2 underline underline-offset-2 hover:text-text-1">
            返回登录
          </Link>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl px-6 py-14 sm:px-10">
        <section className="mx-auto max-w-[720px]">
          <h1 className="mb-6 text-[2.55rem] font-semibold tracking-[-0.02em] text-text-0" style={{ fontFamily: '"Iowan Old Style", Georgia, serif' }}>
            服务条款
          </h1>
          <div className="mb-4 flex items-center justify-between border-b border-border/80 pb-4 text-xs text-text-2">
            <span>生效日期：2026年4月15日</span>
            <Link href="/privacy" className="underline underline-offset-2 hover:text-text-1">
              查看隐私政策
            </Link>
          </div>
          <div className="space-y-5 text-[1rem] leading-8 text-text-1">
            <p>欢迎使用小窗。继续使用本服务即表示您同意遵守本条款及相关规则。</p>
            <p>您应提供真实、合法、有效的注册信息，并妥善保管账号及验证凭证，不得转借或共享给他人使用。</p>
            <p>您不得利用本服务进行违法违规、侵害他人权益或破坏系统安全的行为。若发生违规，我们有权采取限制功能、暂停或终止服务等措施。</p>
            <p>我们将持续优化产品能力，并可能基于业务发展调整功能或条款内容；如有重要变更，将以合理方式进行提示。</p>
          </div>
        </section>
      </main>
    </div>
  )
}
