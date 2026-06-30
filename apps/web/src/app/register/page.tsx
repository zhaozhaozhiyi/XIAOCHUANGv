import Image from 'next/image'
import Link from 'next/link'

import { RegisterForm } from './register-form'

type SearchParams = Promise<Record<string, string | string[] | undefined>>

export default async function RegisterPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams
  const next = typeof params.next === 'string' && params.next.startsWith('/') ? params.next : '/'

  return (
    <div className="relative min-h-screen overflow-hidden bg-bg-page">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_14%_10%,color-mix(in_srgb,var(--color-accent)_18%,transparent),transparent_38%),radial-gradient(circle_at_88%_88%,color-mix(in_srgb,var(--color-accent)_8%,transparent),transparent_44%)]" />
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,color-mix(in_srgb,var(--color-bg-0)_42%,transparent)_0%,color-mix(in_srgb,var(--color-bg-0)_6%,transparent)_34%,transparent_58%)]" />
      <div className="pointer-events-none absolute inset-0 opacity-[0.35] [background-size:22px_22px] [background-image:radial-gradient(color-mix(in_srgb,var(--color-text-0)_7.5%,transparent)_0.45px,transparent_0.45px)]" />

      <header className="absolute left-0 top-0 z-10 w-full">
        <div className="mx-auto flex max-w-6xl items-start px-6 py-7 sm:px-10">
          <Link href="/" className="inline-flex items-center gap-3 text-text-0">
            <span className="relative flex h-10 w-10 items-center justify-center overflow-hidden rounded-[14px] border border-border/70 bg-brand-mark shadow-[0_6px_18px_rgba(40,28,18,0.08)]">
              <Image src="/window.svg" alt="小窗 Logo" fill sizes="24px" className="scale-[0.68] object-contain" />
            </span>
            <span className="flex flex-col leading-none">
              <span
                className="text-[1.15rem] font-semibold tracking-[-0.012em]"
                style={{ fontFamily: '"Iowan Old Style", Georgia, serif' }}
              >
                小窗
              </span>
              <span className="mt-1 text-[0.7rem] font-medium uppercase tracking-[0.2em] text-text-2">
                XIAOCHUANG
              </span>
            </span>
          </Link>
        </div>
      </header>

      <div className="relative z-[1] mx-auto flex min-h-screen max-w-5xl items-center justify-center px-6 py-14 sm:px-8">
        <div className="w-full max-w-[470px]">
          <p
            className="mb-3 text-center text-[2.12rem] font-semibold tracking-[-0.018em] text-text-1 sm:text-[2.42rem]"
            style={{ fontFamily: '"Iowan Old Style", Georgia, serif' }}
          >
            创建你的创作工作室
          </p>
          <p className="mb-7 text-center text-[0.78rem] font-semibold tracking-[0.14em] text-text-2/80">
            CREATE YOUR ACCOUNT
          </p>
          <div className="rounded-[32px] border border-border/65 bg-bg-0/90 p-6 shadow-[0_28px_70px_rgba(40,28,18,0.16),0_2px_0_color-mix(in_srgb,var(--color-bg-0)_60%,transparent)_inset] backdrop-blur-[4px] sm:p-8">
            <RegisterForm next={next} />
          </div>
        </div>
      </div>
    </div>
  )
}
