'use client'

import type { Icon } from '@phosphor-icons/react'
import { BookOpen, FilmSlate, Gear, House, Stack, UserCircle, GridFour } from '@phosphor-icons/react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useCallback, type ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { prefetchNavData } from '@/lib/nav-prefetch'

function SidebarItemLabel({ children }: { children: ReactNode }) {
  return (
    <span
      className={cn(
        'pointer-events-none absolute left-[calc(100%+10px)] top-1/2 z-10 -translate-y-1/2 whitespace-nowrap rounded-lg border border-border bg-bg-0 px-2.5 py-1 text-[11px] font-medium leading-none text-text-1',
        'shadow-shadow-sm',
        '-translate-x-1 opacity-0 transition-[opacity,transform] duration-150 ease-out group-hover:translate-x-0 group-hover:opacity-100 group-focus-visible:translate-x-0 group-focus-visible:opacity-100',
      )}
      aria-hidden
    >
      {children}
    </span>
  )
}

function SidebarNavIcon({ Icon: NavIcon, active }: { Icon: Icon; active: boolean }) {
  return (
    <NavIcon
      size={20}
      weight={active ? 'fill' : 'regular'}
      className="shrink-0"
      aria-hidden
    />
  )
}

type NavItem = {
  href: string
  title: string
  match: (pathname: string) => boolean
  Icon: Icon
  placeholder?: boolean
}

const MAIN_NAV: NavItem[] = [
  { href: '/', title: '主页', match: (p) => p === '/', Icon: House },
  { href: '/drama', title: '短剧', match: (p) => p === '/drama' || p.startsWith('/drama/'), Icon: FilmSlate },
  { href: '/canvas', title: '画布', match: (p) => p === '/canvas' || p.startsWith('/canvas/'), Icon: GridFour },
  { href: '/writing', title: '小说', match: (p) => p === '/writing' || p.startsWith('/writing/'), Icon: BookOpen },
  { href: '/assets', title: '资产', match: (p) => p === '/assets', Icon: Stack },
]

const BOTTOM_NAV: NavItem[] = [
  { href: '/settings', title: '设置', match: (p) => p === '/settings', Icon: Gear },
  { href: '/my', title: '我的', match: (p) => p === '/my', Icon: UserCircle },
]

function AppSidebarFrame({
  pathname,
  onPrefetch,
}: {
  pathname: string | null
  onPrefetch?: (href: string) => void
}) {
  const renderItem = ({ href, title, match, Icon, placeholder }: NavItem) => {
    const active = pathname ? match(pathname) : false
    return (
      <Link
        key={title}
        href={href}
        scroll={false}
        className={cn(
          'group relative z-10 flex size-11 shrink-0 items-center justify-center rounded-xl text-text-2 outline-none transition-colors duration-150 sm:size-12 sm:rounded-[13px]',
          !active && 'hover:bg-bg-hover hover:text-text-0',
          active && 'text-accent',
          placeholder && 'opacity-50 hover:opacity-70',
        )}
        aria-label={title}
        aria-current={active ? 'page' : undefined}
        title={placeholder ? `${title}（功能开发中）` : title}
        onMouseEnter={() => onPrefetch?.(href)}
        onFocus={() => onPrefetch?.(href)}
        onTouchStart={() => onPrefetch?.(href)}
      >
        <SidebarNavIcon Icon={Icon} active={active} />
        <span className="sr-only">{title}</span>
        <SidebarItemLabel>{title}{placeholder ? '（占位）' : ''}</SidebarItemLabel>
      </Link>
    )
  }

  return (
    <aside
      className="pointer-events-auto relative isolate z-40 flex w-[72px] shrink-0 items-stretch justify-center bg-transparent px-1.5 pt-4 pb-1.5 align-middle sm:w-[76px] sm:px-2 sm:pt-5 sm:pb-1.5 lg:w-[80px]"
      aria-label="主导航"
    >
      <div className="mx-auto flex h-full w-full max-w-[56px] flex-col items-center rounded-[16px] bg-bg-0 py-3 shadow-shadow-elevated sm:max-w-[60px]">
        <nav className="flex w-full flex-1 flex-col items-center justify-center gap-3" aria-label="页面">
          {MAIN_NAV.map(renderItem)}
        </nav>
        <div aria-hidden className="my-2.5 h-px w-7 shrink-0 bg-border" />
        <nav className="relative z-50 flex w-full shrink-0 flex-col items-center gap-3" aria-label="账户">
          {BOTTOM_NAV.map(renderItem)}
        </nav>
      </div>
    </aside>
  )
}

export function AppSidebar() {
  const pathname = usePathname()
  const router = useRouter()

  const handlePrefetch = useCallback((href: string) => {
    if (!href || href === pathname) return
    router.prefetch(href)
    prefetchNavData(href)
  }, [pathname, router])

  return <AppSidebarFrame pathname={pathname} onPrefetch={handlePrefetch} />
}

/** Suspense fallback：保留完整可点击导航，避免切换路由时侧栏短暂空白 */
export function AppSidebarFallback() {
  return <AppSidebarFrame pathname={null} />
}
