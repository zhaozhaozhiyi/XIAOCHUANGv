'use client'

import { Textarea } from '@/components/ui/textarea'

type Props = {
  contentMd: string
  onContentChange: (value: string) => void
}

export function OutlineStepPanel({ contentMd, onContentChange }: Props) {
  return (
    <div className="flex h-full min-h-0 flex-col bg-bg-0">
      <div className="mx-auto flex min-h-0 w-full max-w-[760px] flex-1 flex-col px-10 pt-10">
        <h2 className="shrink-0 font-serif text-[26px] font-bold leading-snug text-text-0">作品大纲</h2>
        <Textarea
          value={contentMd}
          onChange={(event) => onContentChange(event.target.value)}
          placeholder="编写或粘贴作品大纲，或用右侧 AI 助手「大纲」技能生成…"
          className="mt-6 min-h-0 flex-1 resize-none border-0 bg-transparent p-0 pb-20 font-serif text-[17px] leading-[2.15] text-text-1 shadow-none placeholder:text-text-3 focus-visible:ring-0"
        />
      </div>
    </div>
  )
}
