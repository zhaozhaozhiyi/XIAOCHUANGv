'use client'

import { ChevronDown, Gauge, Server, SmilePlus } from 'lucide-react'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import type { AudioConfigOption } from '@/components/create/input-composer-types'

const COMPOSER_CHIP_BTN =
  'inline-flex items-center gap-1.5 rounded-[8px] border border-border bg-bg-0 px-2.5 py-1.5 text-text-1 transition-colors hover:bg-bg-hover'

const AUDIO_EMOTION_OPTIONS = [
  { label: '默认', value: '' },
  { label: '开心', value: 'happy' },
  { label: '悲伤', value: 'sad' },
  { label: '愤怒', value: 'angry' },
  { label: '害怕', value: 'fear' },
  { label: '惊讶', value: 'surprise' },
  { label: '平静', value: 'neutral' },
] as const

const AUDIO_SPEED_OPTIONS = [
  { label: '慢速 0.8x', value: 0.8 },
  { label: '标准 1.0x', value: 1 },
  { label: '稍快 1.15x', value: 1.15 },
  { label: '快速 1.3x', value: 1.3 },
] as const

export function AudioModeControls(props: {
  audioEmotion: string
  audioSpeed: number
  audioConfigOptions: AudioConfigOption[]
  audioConfigsLoading: boolean
  selectedAudioConfigId: number | null
  onSelectAudioConfig: (value: number) => void
  onSelectAudioEmotion: (value: string) => void
  onSelectAudioSpeed: (value: number) => void
}) {
  const selectedAudioEmotionLabel =
    AUDIO_EMOTION_OPTIONS.find((item) => item.value === props.audioEmotion)?.label ?? AUDIO_EMOTION_OPTIONS[0].label
  const selectedAudioSpeedLabel =
    AUDIO_SPEED_OPTIONS.find((item) => item.value === props.audioSpeed)?.label ?? `${props.audioSpeed}x`
  const selectedAudioConfig = props.audioConfigOptions.find((item) => item.id === props.selectedAudioConfigId)
  const selectedAudioConfigLabel = props.audioConfigsLoading
    ? '加载服务商…'
    : (selectedAudioConfig?.label ?? (props.audioConfigOptions.length ? '选择服务商' : '未配置 · 前往设置'))

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" className={COMPOSER_CHIP_BTN}><Server size={14} />{selectedAudioConfigLabel}<ChevronDown size={14} className="opacity-70" /></button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="min-w-[220px] rounded-[12px] p-1.5">
          <DropdownMenuLabel className="px-2 pb-1 pt-2 text-xs text-text-3">音频服务商</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {props.audioConfigOptions.length ? props.audioConfigOptions.map((item) => (
            <DropdownMenuItem key={item.id} className="rounded-[8px] px-2 py-2" onSelect={() => props.onSelectAudioConfig(item.id)}>
              <div className="flex min-w-0 flex-1 flex-col gap-0.5 pr-2">
                <span className="truncate text-sm font-medium text-text-0">{item.label}</span>
                <span className="truncate text-[10px] text-text-3">{item.description}</span>
              </div>
              {item.id === props.selectedAudioConfigId ? <span className="ml-auto shrink-0 text-text-2">✓</span> : null}
            </DropdownMenuItem>
          )) : (
            <DropdownMenuItem disabled className="rounded-[8px] px-2 py-2">
              {props.audioConfigsLoading ? '加载中…' : '暂无可用服务商'}
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" className={COMPOSER_CHIP_BTN}><SmilePlus size={14} />{selectedAudioEmotionLabel}<ChevronDown size={14} className="opacity-70" /></button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="min-w-[150px] rounded-[12px] p-1.5">
          {AUDIO_EMOTION_OPTIONS.map((item) => (
            <DropdownMenuItem key={item.value || 'default'} className="rounded-[8px] px-2 py-2" onSelect={() => props.onSelectAudioEmotion(item.value)}>
              {item.label}
              {item.value === props.audioEmotion ? <span className="ml-auto text-text-2">✓</span> : null}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" className={COMPOSER_CHIP_BTN}><Gauge size={14} />{selectedAudioSpeedLabel}<ChevronDown size={14} className="opacity-70" /></button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="min-w-[150px] rounded-[12px] p-1.5">
          {AUDIO_SPEED_OPTIONS.map((item) => (
            <DropdownMenuItem key={item.value} className="rounded-[8px] px-2 py-2" onSelect={() => props.onSelectAudioSpeed(item.value)}>
              {item.label}
              {item.value === props.audioSpeed ? <span className="ml-auto text-text-2">✓</span> : null}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  )
}
