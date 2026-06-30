'use client'

import { Merge, Download, RefreshCw } from 'lucide-react'
import { useWorkbench } from '@/hooks/use-workbench'
import { Button } from '@/components/ui/button'

export function ExportPanel() {
  const wb = useWorkbench()
  const composedCount = wb.storyboards.filter(s => s.composed_video_url).length
  const totalShots = wb.storyboards.length
  const canMerge = totalShots > 0 && composedCount === totalShots
  const fallbackAction = totalShots === 0
    ? { label: '前往分镜', step: 'script-storyboard' }
    : { label: '前往视频合成', step: 'prod-compose' }

  return (
    <div className="export-main">
      <div className="export-preview export-frame">
        <div className="export-head">
          <Merge size={40} className="text-accent" />
          <div className="empty-title">导出成片</div>
          <div className="loading-text">
            {totalShots > 0 && (
              <span>{composedCount}/{totalShots} 镜头已合成</span>
            )}
          </div>
        </div>

        {wb.mergeUrl ? (
          <>
            <video
              src={wb.mergeUrl.startsWith('/') ? wb.mergeUrl : `/${wb.mergeUrl}`}
              className="w-full rounded-xl border border-border shadow-shadow-lg"
              controls
              preload="metadata"
            />
            <div className="export-actions">
              <a
                href={wb.mergeUrl.startsWith('/') ? wb.mergeUrl : `/${wb.mergeUrl}`}
                download
                className="panel-btn panel-btn-primary export-download-link"
              >
                <Download size={14} /> 下载成片
              </a>
            <Button variant="ghost" className="panel-btn" onClick={wb.mergeEpisode}>
              <RefreshCw size={13} /> 重新合并
            </Button>
            </div>
          </>
        ) : (
          <div className="step-empty">
            {composedCount < totalShots && totalShots > 0 && (
              <div className="export-warn">
                还有 {totalShots - composedCount} 个镜头未合成，需完成合成后再导出
              </div>
            )}
            {totalShots === 0 && (
              <div className="empty-desc">
                暂无分镜，请先完成前面的步骤
              </div>
            )}
            <div className="empty-desc">
              将所有合成的镜头合并为完整成片
            </div>
          </div>
        )}
      </div>
      {!wb.mergeUrl && (
        <div className="step-bubble">
          <button
            className="bubble-btn primary"
            onClick={canMerge ? wb.mergeEpisode : () => wb.goSubStep(fallbackAction.step)}
          >
            {canMerge ? '开始合并' : fallbackAction.label}
          </button>
        </div>
      )}
    </div>
  )
}
