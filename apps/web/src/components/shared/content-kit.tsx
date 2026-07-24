import type { ReactNode } from 'react'
import { Loader2, type LucideIcon } from 'lucide-react'

import { cn } from '@/lib/cn'

export function ContentPageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: string
  description?: string
  actions?: ReactNode
  className?: string
}) {
  return (
    <div className={cn('content-page-head', className)}>
      <div className="content-page-copy">
        <h1 className="page-title">{title}</h1>
        {description ? <p className="page-subtitle">{description}</p> : null}
      </div>
      {actions ? <div className="content-page-actions">{actions}</div> : null}
    </div>
  )
}

export function ContentSurface({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return <section className={cn('content-surface', className)}>{children}</section>
}

export function ContentToolbar({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return <div className={cn('content-toolbar', className)}>{children}</div>
}

export function ContentSummary({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return <p className={cn('content-summary', className)}>{children}</p>
}

export function ContentStateBlock({
  title,
  description,
  icon: Icon = Loader2,
  busy = false,
  className,
  children,
}: {
  title: string
  description?: string
  icon?: LucideIcon
  busy?: boolean
  className?: string
  children?: ReactNode
}) {
  return (
    <div
      className={cn('content-state', className)}
      role={busy ? 'status' : undefined}
      aria-live={busy ? 'polite' : undefined}
    >
      <div className="content-state-icon">
        <Icon className={cn('size-5', busy && 'animate-spin')} aria-hidden />
      </div>
      <div className="content-state-copy">
        <p className="content-state-title">{title}</p>
        {description ? <p className="content-state-description">{description}</p> : null}
      </div>
      {children}
    </div>
  )
}

export function ContentGridSkeleton({
  count = 6,
  className,
  itemClassName,
}: {
  count?: number
  className?: string
  itemClassName?: string
}) {
  return (
    <div className={cn('content-grid-skeleton', className)}>
      {Array.from({ length: count }).map((_, index) => (
        <div key={index} className={cn('content-grid-skeleton-card', itemClassName)} />
      ))}
    </div>
  )
}
