import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/cn'
import { Button } from '@/components/ui/button'

type EmptyStateProps = {
  icon: LucideIcon
  description: string
  actionLabel?: string
  onAction?: () => void
  className?: string
  children?: ReactNode
}

export function EmptyState({
  icon: Icon,
  description,
  actionLabel,
  onAction,
  className,
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
      <p className="mt-4 max-w-md text-sm leading-7 text-text-2">{description}</p>
      {children}
      {actionLabel && onAction ? (
        <Button type="button" variant="default" className="mt-6 rounded-[var(--radius-md)] px-5 shadow-none" onClick={onAction}>
          {actionLabel}
        </Button>
      ) : null}
    </div>
  )
}
