import type { TaskRecord } from '@/types/api'
import { getAiErrorCopy } from '@/lib/ai-error-copy'
import { getEpisodeWorkbenchHref, type EpisodeStage } from './episodes/episode-route'

type EpisodeTarget = {
  id: number
  episode_number: number
}

function inferredStage(task: TaskRecord): EpisodeStage {
  if (task.source_stage) return task.source_stage

  const value = `${task.type} ${task.source_type}`.toLowerCase()
  if (value.includes('storyboard')) return 'storyboard'
  if (value.includes('image') || value.includes('frame')) return 'assets'
  if (value.includes('audio') || value.includes('tts') || value.includes('video')) return 'video'
  if (value.includes('compose') || value.includes('merge')) return 'final'
  return 'script'
}

function containsMachinePrompt(value: string) {
  return /<[^>]+>|studio ghibli|prompt|negative|0-\d+秒|seed|model|provider|高清|高质量/i.test(value)
}

function compactText(value: string, max = 28) {
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (!normalized) return ''
  return normalized.length > max ? `${normalized.slice(0, max)}…` : normalized
}

export function getTaskDisplayTitle(task: TaskRecord) {
  const rawTitle = task.title?.trim() || ''
  const signature = `${task.type} ${task.source_type} ${rawTitle}`.toLowerCase()
  const domain = task.domain ?? {}

  if (signature.includes('storyboard')) return '拆解分镜'
  if (signature.includes('first') || signature.includes('frame') || signature.includes('image')) {
    const shotTitle = typeof domain.title === 'string' ? domain.title : ''
    return shotTitle ? `镜头画面 · ${compactText(shotTitle, 18)}` : '生成镜头画面'
  }
  if (signature.includes('audio') || signature.includes('tts') || signature.includes('voice')) return '生成配音'
  if (signature.includes('video')) return '生成镜头视频'
  if (signature.includes('compose')) return '合成镜头'
  if (signature.includes('merge') || signature.includes('export')) return '生成成片'
  if (signature.includes('story-graph')) return '构建故事地图'
  if (signature.includes('script')) return '生成剧本'
  if (signature.includes('blueprint') || signature.includes('episode')) return '规划分集'
  if (signature.includes('source')) return '理解源稿'

  if (rawTitle && !containsMachinePrompt(rawTitle)) return compactText(rawTitle, 30)
  return '处理短剧任务'
}

export function getTaskDisplayMeta(task: TaskRecord) {
  const pieces: string[] = []
  if (task.storyboard_id) pieces.push(`镜头 ${task.storyboard_id}`)
  if (task.attempt_count && task.attempt_count > 1) pieces.push(`第 ${task.attempt_count} 次尝试`)
  pieces.push(taskStatusLabel(task.status))
  return pieces.join(' · ')
}

export function getTaskSourceHref(
  task: TaskRecord,
  context: { dramaId: number; episodes: EpisodeTarget[] },
) {
  if (task.source_route?.startsWith('/')) return task.source_route

  const episode = context.episodes.find((item) => item.id === task.episode_id)
  if (episode) {
    return getEpisodeWorkbenchHref(context.dramaId, episode.episode_number, inferredStage(task), {
      shot: task.storyboard_id,
      task: task.id,
      origin: 'task',
    })
  }

  return `/drama/${context.dramaId}?task=${task.id}&origin=task`
}

export function taskStatusLabel(status: string) {
  const labels: Record<string, string> = {
    queued: '等待执行',
    running: '正在生成',
    completed: '已生成，待确认',
    failed: '生成未完成',
    canceled: '已取消',
    dead_letter: '需要处理',
  }
  return labels[status] || '需要处理'
}

export function isTaskActive(task: Pick<TaskRecord, 'status'>) {
  return task.status === 'queued' || task.status === 'running'
}

export function isTaskFailed(task: Pick<TaskRecord, 'status'>) {
  return task.status === 'failed' || task.status === 'dead_letter' || task.status === 'canceled'
}

export function taskFailureCopy(task: Pick<TaskRecord, 'status' | 'error_kind' | 'error_message'>) {
  if (task.status === 'canceled') return '这项生成已停止。确认内容后可以重新发起。'
  if (task.error_kind === 'backfill_failed') return '内容已生成，但结果没有成功保存。请回到来源后重试。'
  if (task.error_kind === 'invalid_config_id') return '当前默认 AI 配置不可用。请检查项目设置后重试。'

  const raw = task.error_message?.trim() || ''
  const friendly = getAiErrorCopy(raw, '这项生成没有完成。请回到来源检查后重试。')
  return friendly === raw ? '这项生成没有完成。请回到来源检查后重试。' : friendly
}

export function taskSuccessCopy(task: TaskRecord) {
  const title = getTaskDisplayTitle(task)
  if (task.storyboard_id) return `${title}已完成，请回到对应镜头确认结果。`
  return `${title}已完成，请回到来源确认当前版本。`
}
