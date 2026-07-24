'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { CheckCircle2, CircleAlert, Loader2, RefreshCw } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { dramaWorkspaceAPI, taskAPI } from '@/lib/api'
import type { TaskRecord } from '@/types/api'
import { useDramaWorkspace } from '../use-drama-workspace'
import {
  getTaskSourceHref,
  isTaskActive,
  isTaskFailed,
  taskFailureCopy,
  taskStatusLabel,
} from '../task-presentation'

function prettyDate(value: string | null | undefined) {
  if (!value) return '未更新'
  return new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function TaskRow({ task, href, busy, onRetry, onCancel }: {
  task: TaskRecord
  href: string
  busy: boolean
  onRetry: (task: TaskRecord) => void
  onCancel: (task: TaskRecord) => void
}) {
  const running = isTaskActive(task)
  const failed = isTaskFailed(task)
  return (
    <div className="drama-task-table-row">
      {running ? <Loader2 size={16} className="animate-spin" /> : failed ? <CircleAlert size={16} /> : <CheckCircle2 size={16} />}
      <span>
        <strong>{task.title || task.type}</strong>
        <small>{task.source_type} · {prettyDate(task.updated_at)}</small>
        {failed ? <em>{taskFailureCopy(task)}</em> : null}
      </span>
      <b>{taskStatusLabel(task.status)}{running ? ` · ${task.progress ?? 0}%` : ''}</b>
      <div className="drama-row-actions">
        {failed && task.status !== 'canceled' ? <Button size="xs" variant="outline" disabled={busy} onClick={() => onRetry(task)}>重新发起</Button> : null}
        {running ? <Button size="xs" variant="outline" disabled={busy} onClick={() => onCancel(task)}>停止</Button> : null}
        <Link href={href}>打开来源</Link>
      </div>
    </div>
  )
}

export function ProjectTasksPanel({ dramaId }: { dramaId: number }) {
  const [tasks, setTasks] = useState<TaskRecord[]>([])
  const [status, setStatus] = useState('')
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pendingAction, setPendingAction] = useState<{ task: TaskRecord; kind: 'retry' | 'cancel' } | null>(null)
  const { data: workspace } = useDramaWorkspace(dramaId)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await dramaWorkspaceAPI.listProjectTasks(dramaId, {
        status: status || undefined,
        page_size: 80,
      }, { bypassCache: true })
      setTasks(res.items)
    } catch {
      setError('任务列表暂时不可用，请稍后刷新。')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load()
    }, 0)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dramaId, status])

  const executeAction = async () => {
    if (!pendingAction) return
    const { task, kind } = pendingAction
    try {
      setBusyId(task.id)
      if (kind === 'retry') {
        await taskAPI.retry(task.id)
        toast.success('任务已重新排队')
      } else {
        await taskAPI.cancel(task.id)
        toast.success('任务已取消')
      }
      setPendingAction(null)
      await load()
    } catch {
      toast.error(kind === 'retry' ? '暂时无法重新发起任务' : '暂时无法取消任务')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="drama-workspace-band">
      <div className="drama-workspace-section-head">
        <h3>项目任务</h3>
        <button type="button" className="drama-inline-link" onClick={() => void load()}><RefreshCw size={14} />刷新</button>
      </div>
      <div className="drama-filter-row">
        {[
          ['', '全部'],
          ['queued,running', '执行中'],
          ['failed,dead_letter,canceled', '需处理'],
          ['completed', '已完成'],
        ].map(([value, label]) => (
          <button key={value || 'all'} type="button" className="drama-filter-chip" data-active={status === value || undefined} onClick={() => setStatus(value)}>{label}</button>
        ))}
      </div>
      {error ? <div className="drama-inline-error">{error}</div> : null}
      {loading ? <div className="drama-empty-inline"><Loader2 size={16} className="animate-spin" />加载任务...</div> : null}
      {!loading && !tasks.length ? <div className="drama-empty-inline">当前筛选下暂无任务</div> : null}
      {!loading && tasks.length ? (
        <div className="drama-task-table">
          {tasks.map((task) => (
            <div key={task.id} className={busyId === task.id ? 'opacity-70' : undefined}>
              <TaskRow
                task={task}
                href={getTaskSourceHref(task, { dramaId, episodes: workspace?.episodes ?? [] })}
                busy={busyId === task.id}
                onRetry={(next) => setPendingAction({ task: next, kind: 'retry' })}
                onCancel={(next) => setPendingAction({ task: next, kind: 'cancel' })}
              />
            </div>
          ))}
        </div>
      ) : null}
      <ConfirmDialog
        open={Boolean(pendingAction)}
        onOpenChange={(next) => !next && setPendingAction(null)}
        title={pendingAction?.kind === 'retry' ? '重新发起这项任务？' : '停止这项任务？'}
        description={pendingAction?.kind === 'retry'
          ? '将使用原有内容重新排队，生成结果仍需要你确认。'
          : '正在生成的内容会停止，已完成的部分不会被删除。'}
        confirmLabel={pendingAction?.kind === 'retry' ? '重新发起' : '停止任务'}
        loading={busyId !== null}
        onConfirm={executeAction}
      />
    </div>
  )
}
