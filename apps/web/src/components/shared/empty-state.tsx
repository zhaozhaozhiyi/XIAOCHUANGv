import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/cn'
import { Button } from '@/components/ui/button'

type EmptyStateProps = {
  icon: LucideIcon
  title?: string
  description: string
  actionLabel?: string
  onAction?: () => void
  className?: string
  action?: ReactNode
  children?: ReactNode
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  actionLabel,
  onAction,
  className,
  action,
  children,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center rounded-[var(--radius-md)] border border-dashed border-border bg-bg-2 px-6 py-10 text-center',
        className,
      )}
    >
      <div className="flex size-12 items-center justify-center rounded-[var(--radius-md)] border border-border bg-bg-0 text-text-3">
        <Icon size={22} aria-hidden />
      </div>
      <div className="mt-4 flex max-w-md flex-col gap-2">
        {title ? <p className="text-lg font-semibold tracking-[-0.01em] text-text-0">{title}</p> : null}
        <p className="text-sm leading-7 text-text-2">{description}</p>
      </div>
      {children}
      {action ? <div className="mt-6">{action}</div> : null}
      {actionLabel && onAction ? (
        <Button type="button" variant="default" className="mt-6 rounded-[var(--radius-md)] px-5 shadow-none" onClick={onAction}>
          {actionLabel}
        </Button>
      ) : null}
    </div>
  )
}
