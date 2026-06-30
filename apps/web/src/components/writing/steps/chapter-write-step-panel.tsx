'use client'

import { Textarea } from '@/components/ui/textarea'

type Props = {
  docTitle: string
  contentMd: string
  onTitleChange: (value: string) => void
  onContentChange: (value: string) => void
}

export function ChapterWriteStepPanel({ docTitle, contentMd, onTitleChange, onContentChange }: Props) {
  return (
    <div className="flex h-full min-h-0 flex-col bg-bg-0">
      <div className="mx-auto flex min-h-0 w-full max-w-[760px] flex-1 flex-col px-10 pt-10">
        <input
          value={docTitle}
          onChange={(event) => onTitleChange(event.target.value)}
          placeholder="章节标题"
          className="w-full shrink-0 border-0 bg-transparent font-serif text-[26px] font-bold leading-snug text-text-0 outline-none placeholder:text-text-3"
          aria-label="章节标题"
        />
        <Textarea
          value={contentMd}
          onChange={(event) => onContentChange(event.target.value)}
          placeholder="开始写作，或通过右侧 AI 助手续写、润色。"
          className="mt-6 min-h-0 flex-1 resize-none border-0 bg-transparent p-0 pb-20 font-serif text-[17px] leading-[2.15] text-text-1 shadow-none placeholder:text-text-3 focus-visible:ring-0"
        />
      </div>
    </div>
  )
}
