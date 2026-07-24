'use client'

import { useEffect, useState } from 'react'
import { AlertTriangle, Loader2, RefreshCw, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { getAiErrorCopy } from '@/lib/ai-error-copy'

type AiFirstTask = {
  id: number
  created_at?: string | Date | null
  error_message?: string | null
  progress?: number | null
  result_summary?: Record<string, unknown> | null
  started_at?: string | Date | null
  status?: string | null
  title?: string | null
  type?: string | null
  updated_at?: string | Date | null
}

type TaskLabel = '源稿理解任务' | '分集蓝图任务' | '剧本正文任务' | '故事地图任务'

type TaskProgressController = {
  taskActionBusyId: number | null
  cancelAiFirstTask: (taskId: number, label: TaskLabel) => Promise<void>
  retryAiFirstTask: (taskId: number, label: TaskLabel) => Promise<void>
}

function parseTaskStartedAt(task: AiFirstTask | null) {
  if (!task) return Date.now()
  const value = task.started_at || task.created_at
  const parsed = value ? new Date(value).getTime() : NaN
  return Number.isFinite(parsed) ? parsed : Date.now()
}

function useTaskElapsed(active: boolean, task: AiFirstTask | null) {
  const [elapsedSeconds, setElapsedSeconds] = useState(0)

  useEffect(() => {
    if (!active || !task) {
      const resetTimer = window.setTimeout(() => setElapsedSeconds(0), 0)
      return () => window.clearTimeout(resetTimer)
    }

    const startedAt = parseTaskStartedAt(task)
    const updateElapsed = () => {
      setElapsedSeconds(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)))
    }

    const initialTimer = window.setTimeout(updateElapsed, 0)
    const timer = window.setInterval(updateElapsed, 1_000)
    return () => {
      window.clearTimeout(initialTimer)
      window.clearInterval(timer)
    }
  }, [active, task])

  return elapsedSeconds
}

function summaryNumber(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

function submittedProductLabel(summary: Record<string, unknown> | null | undefined) {
  if (!summary) return ''
  const readyChunks = summaryNumber(summary.ready_chunks)
  const totalChunks = summaryNumber(summary.total_chunks)
  if (readyChunks || totalChunks) {
    return totalChunks ? `源稿分块 ${readyChunks}/${totalChunks}` : `源稿分块 ${readyChunks}`
  }

  const generatedEpisodes = summaryNumber(summary.generated_episodes)
  const blueprintTarget = summaryNumber(summary.target_episode_count) || summaryNumber(summary.total_episodes)
  if (generatedEpisodes || blueprintTarget) {
    return blueprintTarget ? `分集蓝图 ${generatedEpisodes}/${blueprintTarget}` : `分集蓝图 ${generatedEpisodes}`
  }

  const completedEpisodes = summaryNumber(summary.completed_episodes)
  const scriptTarget = summaryNumber(summary.target_episodes) || summaryNumber(summary.total_episodes)
  if (completedEpisodes || scriptTarget) {
    return scriptTarget ? `剧本正文 ${completedEpisodes}/${scriptTarget}` : `剧本正文 ${completedEpisodes}`
  }

  const entities = summaryNumber(summary.submitted_entities)
  const relations = summaryNumber(summary.submitted_relations)
  const events = summaryNumber(summary.submitted_events)
  if (entities || relations || events) {
    return [`${entities} 实体`, `${relations} 关系`, `${events} 事件`].join(' · ')
  }

  const storyboardCount = summaryNumber(summary.storyboard_count)
  if (storyboardCount) return `分镜 ${storyboardCount} 镜`

  const accepted = Array.isArray(summary.accepted) ? summary.accepted.length : 0
  if (accepted) return `已提交 ${accepted} 集`
  return ''
}

export function DramaAiTaskProgress({
  active,
  cancelLabel,
  controller,
  detail,
  failed,
  label,
  progress,
  retryLabel,
  task,
}: {
  active: boolean
  cancelLabel: TaskLabel
  controller: TaskProgressController
  detail: string
  failed: boolean
  label: string
  progress: number
  retryLabel: string
  task: AiFirstTask | null
}) {
  const elapsedSeconds = useTaskElapsed(active, task)

  if (!task || (!active && !failed)) return null

  const summary = task.result_summary ?? null
  const phase = failed ? `${label}失败` : label
  const submittedProduct = submittedProductLabel(summary)
  const failureReason = failed
    ? getAiErrorCopy(task.error_message, '请检查大模型服务配置后重试。')
    : ''
  const detailRows = [
    ['阶段', phase],
    submittedProduct ? ['产物', submittedProduct] : null,
    failureReason ? ['失败', failureReason] : null,
  ].filter((row): row is string[] => Boolean(row && row[1]))

  return (
    <section
      className="drama-ai-task-progress"
      data-failed={failed || undefined}
      role={failed ? 'alert' : 'status'}
      aria-live="polite"
    >
      <div className="drama-ai-task-progress-head">
        <div>
          {failed ? <AlertTriangle size={15} /> : <Loader2 size={15} className="animate-spin" />}
          <strong>{failed ? `${label}失败` : label}</strong>
        </div>
        <span>{progress}%</span>
      </div>
      <div className="drama-ai-task-progress-bar">
        <i style={{ width: `${progress}%` }} />
      </div>
      <p>{failed ? getAiErrorCopy(task.error_message, '请检查大模型服务配置后重试。') : detail}</p>
      <dl className="drama-ai-task-progress-details">
        {detailRows.map(([term, description]) => (
          <div key={term}>
            <dt>{term}</dt>
            <dd>{description}</dd>
          </div>
        ))}
      </dl>
      {active && elapsedSeconds >= 15 ? (
        <p className="drama-ai-task-progress-slow">
          {progress === 0
            ? '任务仍在等待后台 AI 任务服务开始处理。若长时间停留在 0%，请检查任务服务是否已启动。'
            : '大模型服务仍在处理中。你可以继续等待或取消后重试。'}
        </p>
      ) : null}
      <div className="drama-ai-task-progress-actions">
        {active ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={controller.taskActionBusyId === task.id}
            onClick={() => {
              void controller.cancelAiFirstTask(task.id, cancelLabel)
            }}
          >
            {controller.taskActionBusyId === task.id ? <Loader2 size={13} className="animate-spin" /> : <X size={13} />}
            取消
          </Button>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={controller.taskActionBusyId === task.id}
            onClick={() => {
              void controller.retryAiFirstTask(task.id, cancelLabel)
            }}
          >
            {controller.taskActionBusyId === task.id ? (
              <Loader2 size={13} className="animate-spin" />
            ) : (
              <RefreshCw size={13} />
            )}
            {retryLabel}
          </Button>
        )}
      </div>
    </section>
  )
}
