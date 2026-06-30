'use client'

import Link from 'next/link'
import { Box, ChevronDown, Clock3, RectangleHorizontal, WandSparkles } from 'lucide-react'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import type { ModelSelectOption } from '@/components/create/input-composer-types'
import { cn } from '@/lib/cn'

const COMPOSER_CHIP_BTN =
  'inline-flex items-center gap-1.5 rounded-[8px] border border-border bg-bg-0 px-2.5 py-1.5 text-text-1 transition-colors hover:bg-bg-hover'

const VIDEO_REFERENCE_OPTIONS = [
  { label: '全能参考', value: 'multiple' },
  { label: '首尾帧参考', value: 'first_last' },
  { label: '单图参考', value: 'single' },
] as const

const ASPECT_RATIO_OPTIONS = [
  { label: '21:9', value: '21:9' },
  { label: '16:9', value: '16:9' },
  { label: '4:3', value: '4:3' },
  { label: '1:1', value: '1:1' },
  { label: '3:4', value: '3:4' },
  { label: '9:16', value: '9:16' },
] as const

const DURATION_OPTIONS = [
  { label: '5 秒', value: 5 },
  { label: '8 秒', value: 8 },
  { label: '10 秒', value: 10 },
] as const

function renderModelMenuItem(item: ModelSelectOption) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-0.5 pr-2">
      <span className="truncate text-sm font-medium text-text-0">{item.label}</span>
      {item.description ? <span className="truncate text-xs text-text-2">{item.description}</span> : null}
      <span className="truncate font-mono text-[10px] text-text-3">{item.tertiary}</span>
    </div>
  )
}

export function VideoModeControls(props: {
  videoModelOptions: ModelSelectOption[]
  videoModel: string
  videoModelsLoading: boolean
  videoReferenceMode: string
  aspectRatio: string | number
  duration: string | number
  onSelectVideoModel: (value: string) => void
  onSelectVideoReferenceMode: (value: string) => void
  onSelectAspectRatio: (value: string) => void
  onSelectDuration: (value: number) => void
}) {
  const selectedVideoModelLabel =
    props.videoModelOptions.find((item) => item.value === props.videoModel)?.label
    ?? (props.videoModelsLoading ? '加载视频模型…' : (props.videoModelOptions.length ? '选择视频模型' : '未配置 · 前往设置'))

  const selectedVideoReferenceLabel =
    VIDEO_REFERENCE_OPTIONS.find((item) => item.value === props.videoReferenceMode)?.label
    ?? VIDEO_REFERENCE_OPTIONS[0].label

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" className={COMPOSER_CHIP_BTN}><Box size={14} />{selectedVideoModelLabel}<ChevronDown size={14} className="opacity-70" /></button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="min-w-[260px] rounded-[12px] p-1.5">
          {props.videoModelOptions.length === 0 ? (
            <DropdownMenuItem asChild className="rounded-[8px] px-2 py-2">
              <Link href="/settings">前往设置 → 视频</Link>
            </DropdownMenuItem>
          ) : props.videoModelOptions.map((item) => (
            <DropdownMenuItem key={item.value} className="rounded-[8px] px-2 py-2" onSelect={() => props.onSelectVideoModel(item.value)}>
              {renderModelMenuItem(item)}
              {item.value === props.videoModel ? <span className="ml-auto shrink-0 text-text-2">✓</span> : null}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" className={COMPOSER_CHIP_BTN}><WandSparkles size={14} />{selectedVideoReferenceLabel}<ChevronDown size={14} className="opacity-70" /></button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="min-w-[180px] rounded-[12px] p-1.5">
          {VIDEO_REFERENCE_OPTIONS.map((item) => (
            <DropdownMenuItem key={item.value} className="rounded-[8px] px-2 py-2" onSelect={() => props.onSelectVideoReferenceMode(item.value)}>
              {item.label}
              {item.value === props.videoReferenceMode ? <span className="ml-auto text-text-2">✓</span> : null}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" className={COMPOSER_CHIP_BTN}><RectangleHorizontal size={14} />{String(props.aspectRatio)}<ChevronDown size={14} className="opacity-70" /></button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-[320px] rounded-[14px] p-3">
          <DropdownMenuLabel className="px-1 pb-2 pt-1 text-xs text-text-3">选择比例</DropdownMenuLabel>
          <div className="grid grid-cols-6 gap-2">
            {ASPECT_RATIO_OPTIONS.map((option) => {
              const active = String(props.aspectRatio) === option.value
              return (
                <DropdownMenuItem
                  key={option.value}
                  className={cn(
                    'group flex cursor-pointer flex-col items-center justify-center gap-1 rounded-[12px] border px-2 py-2.5 outline-none transition-colors',
                    active ? 'border-accent-glow bg-accent-bg text-accent' : 'border-border bg-bg-0 text-text-1 hover:bg-bg-hover',
                  )}
                  onSelect={() => props.onSelectAspectRatio(option.value)}
                >
                  <span aria-hidden className={cn('flex h-5 w-7 items-center justify-center rounded-[6px] border bg-bg-0 transition-colors', active ? 'border-border-focus' : 'border-border-strong group-hover:border-border-focus')}>
                    <span className="block rounded-[3px] border border-border-strong" style={{ width: option.value === '1:1' ? 12 : option.value === '9:16' || option.value === '3:4' ? 10 : 14, height: option.value === '1:1' ? 12 : option.value === '9:16' || option.value === '3:4' ? 14 : 10 }} />
                  </span>
                  <span className="text-[11px] font-medium leading-none">{option.label}</span>
                </DropdownMenuItem>
              )
            })}
          </div>
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" className={COMPOSER_CHIP_BTN}><Clock3 size={14} />{`${props.duration}s`}<ChevronDown size={14} className="opacity-70" /></button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="min-w-[120px] rounded-[12px] p-1.5">
          {DURATION_OPTIONS.map((option) => (
            <DropdownMenuItem key={option.value} className="rounded-[8px] px-2 py-2" onSelect={() => props.onSelectDuration(option.value)}>
              {`${option.value}s`}
              {Number(props.duration) === option.value ? <span className="ml-auto text-text-2">✓</span> : null}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  )
}
