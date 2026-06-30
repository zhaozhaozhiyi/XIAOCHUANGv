'use client'

import Image from 'next/image'
import Link from 'next/link'

/** 与 UI 规范 §1.6 一致：52px 顶栏，左侧品牌 + 右侧弱辅助 slogan */
export const SHELL_HEADER_HEIGHT_PX = 52

export function Header() {
  return (
    <header className="sticky top-0 z-20 flex h-[52px] shrink-0 items-center gap-4 bg-bg-surface-glass px-4 backdrop-blur-xl sm:px-6">
      <Link
        href="/"
        className="flex items-center gap-2.5 rounded-[16px] pr-2 transition-opacity hover:opacity-85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-page"
        aria-label="返回首页"
      >
        <span className="flex size-9 items-center justify-center overflow-hidden rounded-[10px] bg-accent shadow-primary-glow">
          <Image src="/window.svg" alt="" width={22} height={22} className="size-[22px] object-contain" priority />
        </span>
        <div className="flex flex-col justify-center gap-0.5 leading-[1.1]">
          <span className="font-display text-sm font-semibold tracking-[0.02em] text-text-0">小窗</span>
          <span className="text-[9px] font-bold tracking-[0.16em] text-text-3">XIAOCHUANG</span>
        </div>
      </Link>

      <div className="flex-1" aria-hidden />

      <p
        className="hidden max-w-[min(100%,280px)] truncate rounded-full border border-border bg-bg-0 px-4 py-1.5 text-[11px] tracking-[0.06em] text-text-3 shadow-shadow-xs md:block"
        title="透过小窗，看见生活的美"
      >
        透过小窗，看见生活的美
      </p>
    </header>
  )
}
