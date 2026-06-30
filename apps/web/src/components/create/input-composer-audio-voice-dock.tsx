'use client'

import { AudioLines, Loader2, Play } from 'lucide-react'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import type { AIVoice } from '@/types/api'

export function AudioVoiceDock(props: {
  voiceOptions: AIVoice[]
  voicesLoading: boolean
  selectedVoiceId: string
  voicePreviewing: boolean
  voicePreviewText: string
  onSelectVoice: (value: string) => void
  onPreview: () => void
}) {
  const selectedVoiceLabel = props.voicesLoading
    ? '加载音色…'
    : (!props.voiceOptions.length
      ? '暂无音色'
      : props.voiceOptions.find((item) => item.voice_id === props.selectedVoiceId)?.voice_name ?? props.voiceOptions[0]?.voice_name ?? '选择音色')

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="inline-flex h-[80px] w-[57px] rotate-[-7deg] transform-gpu flex-col items-center justify-center gap-1 rounded-none border border-info/40 bg-info text-on-accent shadow-[0_6px_14px_rgba(75,93,120,0.18)] transition-transform duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] will-change-transform hover:scale-[1.04] hover:brightness-110 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-80"
            disabled={!props.voiceOptions.length && !props.voicesLoading}
            aria-label={`选择音色：${selectedVoiceLabel}`}
            title={props.voiceOptions.length ? selectedVoiceLabel : '暂无可用音色'}
          >
            <AudioLines size={17} strokeWidth={2.2} />
            <span className="max-w-[48px] truncate text-[12px] font-medium leading-none text-on-accent">{selectedVoiceLabel}</span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="max-h-[320px] min-w-[260px] overflow-y-auto rounded-[12px] p-1.5">
          <DropdownMenuLabel className="px-2 pb-1 pt-2 text-xs text-text-3">音色选择</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {props.voiceOptions.length ? props.voiceOptions.map((item) => (
            <DropdownMenuItem key={item.voice_id} className="rounded-[8px] px-2 py-2" onSelect={() => props.onSelectVoice(item.voice_id)}>
              <AudioLines className="text-text-2" />
              <span className="min-w-0 flex-1 truncate">{item.voice_name}</span>
              {item.voice_id === props.selectedVoiceId ? <span className="ml-auto text-text-2">✓</span> : null}
            </DropdownMenuItem>
          )) : (
            <DropdownMenuItem disabled className="rounded-[8px] px-2 py-2">
              {props.voicesLoading ? '加载音色中…' : '暂无可用音色'}
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation()
          props.onPreview()
        }}
        className="absolute bottom-1 right-0 inline-flex size-9 items-center justify-center rounded-full border border-border bg-bg-0 text-text-0 shadow-[0_8px_18px_rgba(17,24,39,0.12)] transition-transform hover:scale-[1.06] active:scale-[0.96] disabled:cursor-wait disabled:text-text-3"
        disabled={!props.selectedVoiceId || props.voicePreviewing}
        aria-label={`试听：${props.voicePreviewText}`}
        title={`试听：${props.voicePreviewText}`}
      >
        {props.voicePreviewing ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} fill="currentColor" className="translate-x-[1px]" />}
      </button>
    </>
  )
}
