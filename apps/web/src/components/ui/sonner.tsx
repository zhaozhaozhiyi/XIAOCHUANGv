'use client'

import { CircleCheck, CircleX, Info, TriangleAlert, Loader2 } from 'lucide-react'
import { useTheme } from 'next-themes'
import { Toaster as Sonner, type ToasterProps } from 'sonner'

/** 类型图标：以"色块图标芯片"承载类型色，卡片本体保持中性高级感 */
const iconChip = 'flex size-7 shrink-0 items-center justify-center rounded-[9px] ring-1'

const icons = {
  success: (
    <span className={`${iconChip} bg-success-bg text-success ring-success/25`}>
      <CircleCheck className="size-[17px]" strokeWidth={2.2} />
    </span>
  ),
  error: (
    <span className={`${iconChip} bg-error-bg text-error ring-error/25`}>
      <CircleX className="size-[17px]" strokeWidth={2.2} />
    </span>
  ),
  warning: (
    <span className={`${iconChip} bg-warning-bg text-warning ring-warning/25`}>
      <TriangleAlert className="size-[17px]" strokeWidth={2.2} />
    </span>
  ),
  info: (
    <span className={`${iconChip} bg-info-bg text-info ring-info/25`}>
      <Info className="size-[17px]" strokeWidth={2.2} />
    </span>
  ),
  loading: (
    <span className={`${iconChip} bg-accent-bg text-accent ring-accent/25`}>
      <Loader2 className="size-[17px] animate-spin" strokeWidth={2.2} />
    </span>
  ),
}

export function Toaster(props: ToasterProps) {
  const { theme = 'system' } = useTheme()

  return (
    <Sonner
      theme={theme as ToasterProps['theme']}
      position="top-right"
      closeButton
      gap={12}
      offset={20}
      icons={icons}
      toastOptions={{
        classNames: {
          toast:
            'group !w-full !items-start !gap-3 !rounded-[16px] !border !border-border ' +
            '!bg-bg-surface-glass !p-4 !pr-9 !text-text-0 ' +
            '!shadow-[0_14px_34px_rgba(40,28,18,0.13),0_3px_10px_rgba(40,28,18,0.07)] ' +
            'backdrop-blur-xl',
          icon: '!m-0 !h-7 !w-7 !self-start',
          content: '!gap-0.5',
          title: '!text-[13.5px] !font-semibold !leading-snug !text-text-0',
          description: '!text-[12.5px] !leading-relaxed !text-text-2',
          // 关闭按钮置于卡片内部右上角，默认带底色，悬停时颜色高亮
          // 注意：Sonner 用 transform: var(--toast-close-button-transform) 定位关闭按钮，
          // Tailwind v4 的 translate-* 只改 translate 属性而非 transform，因此需用 transform-none 覆盖
          closeButton:
            '!left-auto !right-2.5 !top-2.5 !transform-none ' +
            '!size-6 !rounded-[8px] !border-none !bg-bg-2 !text-text-3 !opacity-100 ' +
            'hover:!bg-bg-hover hover:!text-text-0 ' +
            'focus-visible:!text-text-0 !transition-colors',
          actionButton:
            '!rounded-[9px] !bg-accent !px-2.5 !text-[12px] !font-medium !text-on-accent hover:!bg-accent-dark',
          cancelButton:
            '!rounded-[9px] !bg-bg-2 !px-2.5 !text-[12px] !font-medium !text-text-2 hover:!bg-bg-hover',
          // 类型描边：与中性卡片本体呼应，提供清晰的类型色区分
          success: '!border-success/35',
          error: '!border-error/35',
          warning: '!border-warning/35',
          info: '!border-info/35',
          loading: '!border-accent/30',
        },
      }}
      {...props}
    />
  )
}
