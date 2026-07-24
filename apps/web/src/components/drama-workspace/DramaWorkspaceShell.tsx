'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent, type ReactNode } from 'react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { toast } from 'sonner'
import {
  ArrowLeft,
  Boxes,
  Check,
  Clapperboard,
  ChevronDown,
  CircleAlert,
  CircleCheck,
  Clock3,
  Film,
  LayoutDashboard,
  ListChecks,
  Loader2,
  Network,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  Settings,
  X,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/cn'
import { dramaAPI, dramaWorkspaceAPI, taskAPI, type DramaWorkspacePayload } from '@/lib/api'
import type { Drama, TaskRecord } from '@/types/api'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import {
  getTaskSourceHref,
  getTaskDisplayMeta,
  getTaskDisplayTitle,
  isTaskActive,
  isTaskFailed,
  taskFailureCopy,
  taskSuccessCopy,
  taskStatusLabel,
} from './task-presentation'
import { useDramaWorkspace } from './use-drama-workspace'

type WorkspaceNavItem = {
  key: string
  label: string
  href: string
  icon: LucideIcon
}

const TASK_PANEL_DEFAULT_HEIGHT = 380
const TASK_PANEL_MIN_HEIGHT = 260

const primaryItems: WorkspaceNavItem[] = [
  { key: 'overview', label: '总览', href: '', icon: LayoutDashboard },
  { key: 'episodes', label: '剧集', href: '/episodes', icon: Film },
  { key: 'canvas', label: '画布', href: '/canvas', icon: Network },
  { key: 'assets', label: '素材', href: '/assets', icon: Boxes },
  { key: 'final', label: '成片', href: '/final', icon: Clapperboard },
]

function projectInitial(title: string) {
  return title.trim().slice(0, 1).toUpperCase() || '剧'
}

function resolveHref(basePath: string, item: WorkspaceNavItem) {
  return `${basePath}${item.href}`
}

function isRouteActive(pathname: string, basePath: string, item: WorkspaceNavItem) {
  const href = resolveHref(basePath, item)
  if (item.key === 'episodes') {
    return pathname === href
      || pathname.startsWith(`${href}/`)
      || pathname.startsWith(`${basePath}/storyboards`)
      || pathname.startsWith(`${basePath}/shots`)
  }
  if (item.key === 'final') {
    return pathname === href
      || pathname.startsWith(`${href}/`)
      || pathname.startsWith(`${basePath}/export`)
  }
  return item.href ? pathname === href || pathname.startsWith(`${href}/`) : pathname === basePath
}

function WorkspaceNavLink({
  item,
  basePath,
  pathname,
  collapsed,
  badge,
}: {
  item: WorkspaceNavItem
  basePath: string
  pathname: string
  collapsed: boolean
  badge?: number
}) {
  const Icon = item.icon
  const active = isRouteActive(pathname, basePath, item)
  const href = resolveHref(basePath, item)

  return (
    <Link
      href={href}
      className={cn('drama-workspace-nav-item', active && 'is-active', collapsed && 'is-collapsed')}
      aria-current={active ? 'page' : undefined}
      aria-label={item.label}
      title={item.label}
    >
      <Icon size={17} />
      <span>{item.label}</span>
      {badge ? <b>{badge}</b> : null}
    </Link>
  )
}

function WorkspaceProjectSwitcher({
  dramaId,
  title,
  subtitle,
  currentHref,
  collapsed,
  open,
  projects,
  loading,
  error,
  onToggle,
  onClose,
  onRetry,
  onToggleSidebar,
}: {
  dramaId: number
  title: string
  subtitle: string
  currentHref: string
  collapsed: boolean
  open: boolean
  projects: Drama[]
  loading: boolean
  error: string | null
  onToggle: () => void
  onClose: () => void
  onRetry: () => void
  onToggleSidebar: () => void
}) {
  return (
    <div className="drama-sidebar-head">
      <div className="drama-project-switcher-combo">
        <button
          type="button"
          className="drama-sidebar-collapse"
          onClick={onToggleSidebar}
          aria-label={collapsed ? '展开侧边栏' : '收起侧边栏'}
        >
          {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
        </button>
        {collapsed ? (
          <span className="drama-project-switcher-collapsed-avatar" title={title} aria-hidden="true">
            <span className="drama-project-avatar">{projectInitial(title)}</span>
          </span>
        ) : (
          <button
            type="button"
            className="drama-project-switcher-trigger"
            onClick={onToggle}
            aria-expanded={open}
            aria-haspopup="menu"
          >
            <span className="drama-project-avatar">{projectInitial(title)}</span>
            <span className="drama-project-switcher-copy">
              <strong>{title}</strong>
              <small>{subtitle}</small>
            </span>
            <ChevronDown size={14} />
          </button>
        )}
      </div>
      {open && !collapsed ? (
        <div className="drama-project-switcher-menu" role="menu" aria-label="切换短剧项目">
          <div className="drama-project-switcher-menu-head">
            <span>切换项目</span>
            <Link href="/drama" onClick={onClose}>
              <ArrowLeft size={13} />
              <span>全部项目</span>
            </Link>
          </div>
          {loading ? (
            <div className="drama-project-switcher-state">
              <Loader2 size={14} className="animate-spin" />
              <span>加载项目中</span>
            </div>
          ) : null}
          {error ? (
            <div className="drama-project-switcher-state is-error">
              <span>无法加载项目列表</span>
              <button type="button" onClick={onRetry}>重试</button>
            </div>
          ) : null}
          {!loading && !error ? (
            projects.length ? (
              <div className="drama-project-switcher-list">
                {projects.map((project) => {
                  const active = project.id === dramaId
                  return (
                    <Link
                      key={project.id}
                      href={`/drama/${project.id}${currentHref}`}
                      className={cn('drama-project-switcher-row', active && 'is-active')}
                      aria-current={active ? 'page' : undefined}
                      onClick={onClose}
                      role="menuitem"
                    >
                      <span className="drama-project-avatar">{projectInitial(project.title)}</span>
                      <span>
                        <strong>{project.title}</strong>
                        <small>{project.status} · {project.episode_count ?? project.total_episodes ?? 0} 集</small>
                      </span>
                      {active ? <Check size={14} /> : null}
                    </Link>
                  )
                })}
              </div>
            ) : (
              <div className="drama-project-switcher-state">暂无短剧项目</div>
            )
          ) : null}
          <Link href="/drama" className="drama-project-switcher-create" onClick={onClose}>
            <LayoutDashboard size={14} />
            <span>项目列表与创建</span>
          </Link>
          <Link href={`/drama/${dramaId}/settings`} className="drama-project-switcher-create" onClick={onClose}>
            <Settings size={14} />
            <span>项目设置</span>
          </Link>
        </div>
      ) : null}
    </div>
  )
}

function WorkspaceTaskStatusBar({
  data,
  onOpen,
}: {
  data: DramaWorkspacePayload | null
  onOpen: () => void
}) {
  const active = data?.counts.active_tasks ?? 0
  const failed = data?.counts.failed_tasks ?? 0

  return (
    <div className="drama-task-status-bar">
      <button type="button" className="drama-task-status-trigger" onClick={onOpen} aria-label="打开任务状态">
        <ListChecks size={15} />
        <span>任务</span>
        {active ? <strong>{active} 个执行中</strong> : failed ? <strong>{failed} 个需处理</strong> : <strong>查看任务</strong>}
      </button>
    </div>
  )
}

function WorkspaceTaskPanel({
  open,
  data,
  onClose,
  onRefresh,
  statusFilter,
}: {
  open: boolean
  data: DramaWorkspacePayload | null
  onClose: () => void
  onRefresh: () => Promise<DramaWorkspacePayload | null>
  statusFilter?: string | null
}) {
  const [tasks, setTasks] = useState<TaskRecord[]>([])
  const [tasksLoading, setTasksLoading] = useState(false)
  const [tasksError, setTasksError] = useState<string | null>(null)
  const [selectedTaskId, setSelectedTaskId] = useState<number | null>(null)
  const [pendingAction, setPendingAction] = useState<{ task: TaskRecord; kind: 'retry' | 'cancel' } | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const projectId = data?.project.id
  const selectedTask = tasks.find((task) => task.id === selectedTaskId) ?? tasks[0] ?? null
  const selectedTaskHref = selectedTask && data
    ? getTaskSourceHref(selectedTask, { dramaId: data.project.id, episodes: data.episodes })
    : null
  const [height, setHeight] = useState(TASK_PANEL_DEFAULT_HEIGHT)
  const panelRef = useRef<HTMLElement | null>(null)

  const loadTasks = useCallback(async () => {
    if (!projectId) return
    setTasksLoading(true)
    setTasksError(null)
    try {
      const result = await dramaWorkspaceAPI.listProjectTasks(
        projectId,
        { page_size: 80, sort: 'updated_at', order: 'desc' },
        { bypassCache: true },
      )
      const nextItems = statusFilter === 'failed'
        ? result.items.filter((task) => isTaskFailed(task))
        : statusFilter
          ? result.items.filter((task) => task.status === statusFilter)
          : result.items
      setTasks(nextItems)
      setSelectedTaskId((current) => current && nextItems.some((task) => task.id === current)
        ? current
        : nextItems[0]?.id ?? null)
    } catch {
      setTasksError('任务列表暂时不可用，请稍后刷新。')
    } finally {
      setTasksLoading(false)
    }
  }, [projectId, statusFilter])

  useEffect(() => {
    if (!open) return
    const loadTimer = window.setTimeout(() => void loadTasks(), 0)
    const panel = panelRef.current
    if (panel && !panel.contains(document.activeElement)) {
      panel.focus()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.clearTimeout(loadTimer)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [loadTasks, onClose, open])

  const executeAction = async () => {
    if (!pendingAction) return
    setSubmitting(true)
    try {
      if (pendingAction.kind === 'retry') {
        await taskAPI.retry(pendingAction.task.id)
        toast.success('任务已重新排队')
      } else {
        await taskAPI.cancel(pendingAction.task.id)
        toast.success('任务已取消')
      }
      setPendingAction(null)
      await Promise.all([loadTasks(), onRefresh()])
    } catch {
      toast.error(pendingAction.kind === 'retry' ? '暂时无法重新发起任务' : '暂时无法取消任务')
    } finally {
      setSubmitting(false)
    }
  }

  const onResizeStart = (event: PointerEvent<HTMLDivElement>) => {
    if (!open) return
    event.preventDefault()
    const startY = event.clientY
    const startHeight = height
    const maxHeight = Math.max(TASK_PANEL_MIN_HEIGHT, window.innerHeight - 112)
    const clampHeight = (next: number) => Math.max(TASK_PANEL_MIN_HEIGHT, Math.min(maxHeight, next))
    const onPointerMove = (moveEvent: globalThis.PointerEvent) => {
      setHeight(clampHeight(startHeight + startY - moveEvent.clientY))
    }
    const onPointerUp = () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
    }
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
  }

  return (
    <>
      <div className={cn('drama-task-panel-backdrop', open && 'is-open')} onClick={onClose} aria-hidden />
      <aside
        ref={panelRef}
        className={cn('drama-task-panel', open && 'is-open')}
        aria-hidden={!open}
        aria-label="任务中心"
        role="region"
        style={{ height: open ? height : 0 }}
        tabIndex={-1}
      >
        <div className="drama-task-panel-resize" onPointerDown={onResizeStart} aria-label="调整任务中心高度" />
        <div className="drama-task-panel-head">
          <h2>{statusFilter === 'failed' ? '需处理任务' : '任务'}</h2>
          <div className="drama-task-panel-head-actions">
            <button type="button" className="drama-workspace-icon-button" onClick={() => void loadTasks()} disabled={tasksLoading} aria-label="刷新任务">
              <RefreshCw size={15} className={tasksLoading ? 'animate-spin' : undefined} />
            </button>
            <button type="button" className="drama-workspace-icon-button" onClick={onClose} aria-label="关闭任务中心">
              <X size={15} />
            </button>
          </div>
        </div>
        <div className="drama-task-panel-body">
          <div className="drama-task-panel-list">
            {tasksLoading ? <div className="drama-empty-inline is-compact"><Loader2 size={15} className="animate-spin" />加载任务...</div> : null}
            {tasksError ? <div className="drama-inline-error">{tasksError}</div> : null}
            {!tasksLoading && !tasksError && tasks.length ? tasks.map((task) => {
              const selected = selectedTask?.id === task.id
              return (
                <button
                  key={task.id}
                  type="button"
                  className={cn('drama-task-panel-row', selected && 'is-selected')}
                  onClick={() => setSelectedTaskId(task.id)}
                >
                  {isTaskActive(task) ? <Loader2 size={15} className="animate-spin" /> : isTaskFailed(task) ? <CircleAlert size={15} /> : <CircleCheck size={15} />}
                    <span>
                      <strong>{getTaskDisplayTitle(task)}</strong>
                      <small>{getTaskDisplayMeta(task)}</small>
                    </span>
                </button>
              )
            }) : null}
            {!tasksLoading && !tasksError && !tasks.length ? <div className="drama-empty-inline">{statusFilter === 'failed' ? '暂无需处理任务' : '暂无任务'}</div> : null}
          </div>
          <div className="drama-task-panel-detail">
            {selectedTask ? (
              <>
                <div className="drama-task-detail-title">
                  <Clock3 size={16} />
                  <h3>{getTaskDisplayTitle(selectedTask)}</h3>
                </div>
                <div className="drama-progress is-large">
                  <i style={{ width: `${selectedTask.progress ?? 0}%` }} />
                </div>
                <dl>
                  <div>
                    <dt>状态</dt>
                    <dd>{taskStatusLabel(selectedTask.status)}</dd>
                  </div>
                  <div>
                    <dt>更新时间</dt>
                    <dd>{new Date(selectedTask.updated_at).toLocaleString('zh-CN')}</dd>
                  </div>
                </dl>
                <p className="drama-task-detail-copy">
                  {isTaskActive(selectedTask)
                    ? '正在处理，完成后会回到原始位置等待你确认。'
                    : isTaskFailed(selectedTask)
                      ? taskFailureCopy(selectedTask)
                      : taskSuccessCopy(selectedTask)}
                </p>
                <div className="drama-task-detail-actions">
                  {selectedTaskHref ? (
                    <Link href={selectedTaskHref} onClick={onClose}>
                      {selectedTask.storyboard_id ? '查看镜头' : '打开任务位置'}
                    </Link>
                  ) : null}
                  {isTaskFailed(selectedTask) && selectedTask.status !== 'canceled' ? (
                    <button type="button" className="drama-inline-link" onClick={() => setPendingAction({ task: selectedTask, kind: 'retry' })}>重新发起</button>
                  ) : null}
                  {isTaskActive(selectedTask) ? (
                    <button type="button" className="drama-inline-link is-danger" onClick={() => setPendingAction({ task: selectedTask, kind: 'cancel' })}>停止任务</button>
                  ) : null}
                </div>
              </>
            ) : (
              <div className="drama-empty-inline">选择一个任务查看详情</div>
            )}
          </div>
        </div>
      </aside>
      <ConfirmDialog
        open={Boolean(pendingAction)}
        onOpenChange={(next) => !next && setPendingAction(null)}
        title={pendingAction?.kind === 'retry' ? '重新发起这项任务？' : '停止这项任务？'}
        description={pendingAction?.kind === 'retry'
          ? '将使用原有内容重新排队，生成结果仍需要你确认。'
          : '正在生成的内容会停止，已完成的部分不会被删除。'}
        confirmLabel={pendingAction?.kind === 'retry' ? '重新发起' : '停止任务'}
        loading={submitting}
        onConfirm={executeAction}
      />
    </>
  )
}

export function DramaWorkspaceShell({
  dramaId,
  children,
}: {
  dramaId: number
  children: ReactNode
}) {
  const pathname = usePathname()
  const router = useRouter()
  const searchParams = useSearchParams()
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [projectSwitcherOpen, setProjectSwitcherOpen] = useState(false)
  const [taskPanelOpen, setTaskPanelOpen] = useState(false)
  const [projects, setProjects] = useState<Drama[]>([])
  const [projectsLoading, setProjectsLoading] = useState(false)
  const [projectsError, setProjectsError] = useState<string | null>(null)
  const { data, loading, error, refresh } = useDramaWorkspace(dramaId)
  const basePath = `/drama/${dramaId}`
  const title = data?.project?.title || `短剧项目 ${dramaId}`
  const isCanvasEditorRoute = pathname.startsWith(`${basePath}/canvas/`)
  const isEpisodeWorkbenchRoute = pathname.startsWith(`${basePath}/episodes/`)
  const taskStatusFilter = searchParams.get('taskStatus')
  const activePathItem = useMemo(() => {
    return primaryItems.find((item) => isRouteActive(pathname, basePath, item)) ?? primaryItems[0]
  }, [basePath, pathname])
  const currentSwitcherHref = activePathItem.href

  const closePanel = useCallback((panel: 'tasks') => {
    setTaskPanelOpen(false)
    if (searchParams.get('panel') === panel) {
      const next = new URLSearchParams(searchParams.toString())
      next.delete('panel')
      router.replace(next.size ? `${pathname}?${next.toString()}` : pathname)
    }
  }, [pathname, router, searchParams])

  useEffect(() => {
    const panel = searchParams.get('panel')
    const timer = window.setTimeout(() => {
      if (panel === 'tasks') setTaskPanelOpen(true)
    }, 0)
    return () => window.clearTimeout(timer)
  }, [searchParams])

  const loadProjects = useCallback(async () => {
    setProjectsLoading(true)
    setProjectsError(null)
    try {
      const res = await dramaAPI.list(
        { include_details: false, page_size: 80 },
        { redirectOnUnauthorized: false, bypassCache: true },
      )
      setProjects(res.items)
    } catch (err) {
      setProjectsError(err instanceof Error ? err.message : String(err))
    } finally {
      setProjectsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!projectSwitcherOpen || sidebarCollapsed) return
    const timer = window.setTimeout(() => {
      void loadProjects()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [loadProjects, projectSwitcherOpen, sidebarCollapsed])

  return (
    <div className={cn('drama-app-layout', isCanvasEditorRoute && 'is-canvas-editor-route')}>
      <div className="drama-app-frame">
        <aside className={cn('drama-workspace-sidebar', sidebarCollapsed && 'is-collapsed')}>
          <WorkspaceProjectSwitcher
            dramaId={dramaId}
            title={title}
            subtitle="短剧项目"
            currentHref={currentSwitcherHref}
            collapsed={sidebarCollapsed}
            open={projectSwitcherOpen}
            projects={projects}
            loading={projectsLoading}
            error={projectsError}
            onToggle={() => setProjectSwitcherOpen((value) => !value)}
            onClose={() => setProjectSwitcherOpen(false)}
            onRetry={() => void loadProjects()}
            onToggleSidebar={() => setSidebarCollapsed((value) => !value)}
          />

          <nav className="drama-workspace-nav" aria-label="短剧项目导航">
            {primaryItems.map((item) => (
              <WorkspaceNavLink
                key={item.key}
                item={item}
                basePath={basePath}
                pathname={pathname}
                collapsed={sidebarCollapsed}
              />
            ))}
          </nav>

          <div className="drama-sidebar-footer">
            <Link href="/drama" title={sidebarCollapsed ? '返回项目列表' : undefined}>
              <ArrowLeft size={14} />
              <span>项目列表</span>
            </Link>
          </div>
        </aside>

        <section className={cn('drama-workspace-main', isCanvasEditorRoute && 'is-canvas-editor-route')}>
          {!isCanvasEditorRoute ? (
            <header className="drama-workspace-topbar">
              <div className="drama-workspace-topbar-left">
                <div className="drama-workspace-title-row">
                  <h1>{title}</h1>
                  <span className="drama-workspace-current-section">{activePathItem.label}</span>
                  {loading ? <Loader2 size={16} className="animate-spin" /> : null}
                </div>
              </div>

              <div className="drama-workspace-topbar-actions">
                {error ? <span className="drama-workspace-error">项目同步暂不可用</span> : null}
                <button type="button" className="drama-workspace-action-button" onClick={() => setTaskPanelOpen(true)} aria-label="任务中心">
                  <ListChecks size={15} />
                  <span>任务</span>
                  {data?.counts.active_tasks ? <b>{data.counts.active_tasks}</b> : null}
                </button>
                <button
                  type="button"
                  className="drama-workspace-icon-button"
                  onClick={() => refresh()}
                  disabled={loading}
                  aria-label={loading ? '正在刷新项目数据' : '刷新项目数据'}
                  title={loading ? '正在刷新项目数据' : '刷新项目数据'}
                >
                  <RefreshCw size={16} className={loading ? 'animate-spin' : undefined} />
                </button>
              </div>
            </header>
          ) : null}

          <div className="drama-route-outlet">
            <main
              id="main-content"
              tabIndex={-1}
              className={cn(
                'drama-workspace-content',
                isCanvasEditorRoute && 'is-canvas-editor',
                isEpisodeWorkbenchRoute && 'is-episode-workbench',
              )}
            >
              {children}
            </main>
          </div>

          {taskPanelOpen ? (
            <WorkspaceTaskPanel
              open={taskPanelOpen}
              data={data}
              onClose={() => closePanel('tasks')}
              onRefresh={refresh}
              statusFilter={taskStatusFilter}
            />
          ) : null}
          {!isCanvasEditorRoute ? (
            <WorkspaceTaskStatusBar data={data} onOpen={() => setTaskPanelOpen((value) => !value)} />
          ) : null}
        </section>
      </div>
    </div>
  )
}
