import Image from 'next/image'
import Link from 'next/link'

export default function PrivacyPage() {
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
            隐私政策
          </h1>
          <div className="mb-4 flex items-center justify-between border-b border-border/80 pb-4 text-xs text-text-2">
            <span>生效日期：2026年4月15日</span>
            <Link href="/terms" className="underline underline-offset-2 hover:text-text-1">
              查看服务条款
            </Link>
          </div>
          <div className="space-y-5 text-[1rem] leading-8 text-text-1">
            <p>我们重视您的个人信息安全，并仅在提供产品与服务所必需的范围内收集和使用相关数据。</p>
            <p>在注册、登录和安全校验过程中，我们会处理手机号、账号标识等必要信息，用于身份验证、风险防控和服务稳定性保障。</p>
            <p>我们不会以非法方式出售或滥用您的个人信息。您可根据平台提供的路径申请查询、更正或删除相关信息。</p>
            <p>若隐私政策发生重大变更，我们将通过合理方式向您提示，变更后继续使用服务即视为您已知悉并同意更新内容。</p>
          </div>
        </section>
      </main>
    </div>
  )
}
