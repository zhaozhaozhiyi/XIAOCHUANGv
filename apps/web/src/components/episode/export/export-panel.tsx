'use client'

import { useEffect, useState } from 'react'
import { AlertTriangle, Download, GitBranch, Loader2, Merge, RefreshCw } from 'lucide-react'
import { isActiveWorkbenchTask, useWorkbench } from '@/hooks/use-workbench'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/cn'
import { getAiErrorCopy } from '@/lib/ai-error-copy'
import { episodeContinuityAPI } from '@/lib/api'
import { staticUrl } from '@/lib/utils'

export function ExportPanel() {
  const wb = useWorkbench()
  const composedCount = wb.storyboards.filter(s => s.composed_video_url).length
  const totalShots = wb.storyboards.length
  const episodeId = wb.episode?.id
  const [requiresEditRevision, setRequiresEditRevision] = useState<boolean | null>(null)
  const isCheckingProductionMode = Boolean(episodeId) && requiresEditRevision == null
  const canMerge = !requiresEditRevision && !isCheckingProductionMode && totalShots > 0 && composedCount === totalShots
  const mergeTask = wb.episode ? wb.entityTasks[`episode-merge:${wb.episode.id}`] : null
  const failedMergeTask = mergeTask && ['failed', 'canceled'].includes(String(mergeTask.status || '')) ? mergeTask : null
  const isMergePending = isActiveWorkbenchTask(mergeTask) || (wb.mergeStatus as { status?: string } | null)?.status === 'pending'
  const mergedMediaUrl = staticUrl(wb.mergeUrl)
  const fallbackAction = requiresEditRevision
    ? { label: '前往连续性', step: 'prod-continuity' }
    : totalShots === 0
    ? { label: '前往分镜', step: 'script-storyboard' }
    : { label: '前往视频合成', step: 'prod-compose' }

  useEffect(() => {
    let canceled = false
    if (!episodeId) return

    void episodeContinuityAPI.get(episodeId)
      .then((continuity) => {
        if (canceled) return
        setRequiresEditRevision(
          continuity.storyboard_set_id != null && continuity.boundaries.length > 0,
        )
      })
      .catch(() => {
        if (!canceled) setRequiresEditRevision(true)
      })

    return () => {
      canceled = true
    }
  }, [episodeId])

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
            {isMergePending ? (
              <span className="ml-2 inline-flex items-center gap-1 text-accent">
                <Loader2 size={12} className="animate-spin" />
                合并中，旧成片会保留到新结果完成
              </span>
            ) : null}
          </div>
        </div>

        {wb.mergeUrl ? (
          <>
            <video
              src={mergedMediaUrl}
              className="w-full rounded-xl border border-border shadow-shadow-lg"
              controls
              preload="metadata"
            />
            <div className="export-actions">
              <a
                href={mergedMediaUrl}
                download
                className="panel-btn panel-btn-primary export-download-link"
              >
                <Download size={14} /> 下载成片
              </a>
              <Button
                variant="ghost"
                className="panel-btn"
                disabled={isMergePending}
                onClick={
                  requiresEditRevision
                    ? () => wb.goSubStep('prod-continuity')
                    : wb.mergeEpisode
                }
              >
                {requiresEditRevision ? (
                  <GitBranch size={13} />
                ) : isMergePending ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : (
                  <RefreshCw size={13} />
                )}
                {requiresEditRevision
                  ? '查看剪辑版本'
                  : isMergePending
                    ? '合并中'
                    : '重新合并'}
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
              {requiresEditRevision
                ? '请先确认连续性剪辑版本，再渲染成片'
                : '将所有合成的镜头合并为完整成片'}
            </div>
          </div>
        )}
        {failedMergeTask ? (
          <div className="entity-task-notice is-error mt-3">
            <AlertTriangle size={13} />
            <span className="entity-task-message">
              {failedMergeTask.status === 'canceled'
                ? '合并任务已取消，可以重新提交。'
                : getAiErrorCopy(new Error(failedMergeTask.error_message || '合并失败'))}
            </span>
            {!requiresEditRevision ? (
              <Button
                type="button"
                size="xs"
                variant="ghost"
                className="panel-btn entity-task-retry"
                onClick={() => wb.retryEntityTask(failedMergeTask.id)}
              >
                <RefreshCw size={10} />
                重试
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
      {!wb.mergeUrl && (
        <div className="step-bubble">
          <button
            className={cn('bubble-btn primary', (isMergePending || isCheckingProductionMode) && 'pending')}
            disabled={isMergePending || isCheckingProductionMode}
            onClick={canMerge ? wb.mergeEpisode : () => wb.goSubStep(fallbackAction.step)}
          >
            {isCheckingProductionMode
              ? '确认成片方式...'
              : isMergePending
                ? '合并中'
                : canMerge
                  ? '开始合并'
                  : fallbackAction.label}
          </button>
        </div>
      )}
    </div>
  )
}
