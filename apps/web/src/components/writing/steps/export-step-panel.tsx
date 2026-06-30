'use client'

import { BookOpen, Download, Loader2 } from 'lucide-react'

import { Button } from '@/components/ui/button'

type Props = {
  exporting: boolean
  importing: boolean
  onExportMarkdown: () => void
  onImportDrama: () => void
}

export function ExportStepPanel({ exporting, importing, onExportMarkdown, onImportDrama }: Props) {
  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <div>
        <h2 className="text-lg font-semibold text-text-0">导出</h2>
        <p className="mt-1 text-sm text-text-3">将作品导出为 Markdown，或导入短剧工程继续制作。</p>
      </div>

      <section className="rounded-[var(--radius-lg)] border border-border bg-bg-0 p-5">
        <div className="text-sm font-medium text-text-1">导出 Markdown</div>
        <p className="mt-1 text-sm text-text-3">下载全书 Markdown 文件，便于备份或在外部编辑。</p>
        <Button className="mt-4" variant="outline" onClick={onExportMarkdown} disabled={exporting}>
          {exporting ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Download className="mr-2 size-4" />}
          下载 Markdown
        </Button>
      </section>

      <section className="rounded-[var(--radius-lg)] border border-border bg-bg-0 p-5">
        <div className="text-sm font-medium text-text-1">导入短剧</div>
        <p className="mt-1 text-sm text-text-3">将当前作品导入短剧工程，进入分镜与视频制作流程。</p>
        <Button className="mt-4" variant="outline" onClick={onImportDrama} disabled={importing}>
          {importing ? <Loader2 className="mr-2 size-4 animate-spin" /> : <BookOpen className="mr-2 size-4" />}
          导入短剧工程
        </Button>
      </section>
    </div>
  )
}
