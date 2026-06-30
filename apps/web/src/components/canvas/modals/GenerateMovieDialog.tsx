'use client'

/**
 * GenerateMovieDialog — 生成成片弹窗（v0.2.0 PR4，PRD §10.2）
 *
 * 内容：
 *   - 镜头清单（按 storyboard 节点列出，每条带 ✓/⚠ 标签：有图 / 有音 / 时长）
 *   - 预计总时长（sum of durations）
 *   - 警告条：缺图 / 缺音 的镜头编号
 *   - ☐ 跳过未配音 / ☐ 跳过未生成视频
 *   - [取消] [开始生成]
 */

import { useCallback, useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, Film, ImageIcon, Loader2, Volume2 } from 'lucide-react'
import { toast } from 'sonner'

import {
  Dialog,
  DialogActions,
  DialogContent,
  DialogHeaderBar,
  DialogMain,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { canvasApi } from '@/lib/canvas/api/canvas'
import { useCanvasStore, useEdgesStore, useNodesStore } from '@/lib/canvas/store'
import type { StoryboardData } from '@/lib/canvas/types'
import { inferAutoEdges, type InferredEdge } from '@/lib/canvas/utils/inferAutoEdges'

import { AutoEdgePreviewDialog } from './AutoEdgePreviewDialog'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 用户已确认开始生成；上层挂 useRunStatus.start(runId) */
  onStart: (runId: string) => void
}

interface ShotRow {
  nodeId: string
  shotIndex: number
  title: string
  duration: number
  hasImage: boolean
  hasAudio: boolean
  hasVideo: boolean
}

export function GenerateMovieDialog({ open, onOpenChange, onStart }: Props) {
  const canvasId = useCanvasStore((s) => s.canvasId)
  const nodes = useNodesStore((s) => s.nodes)
  const edges = useEdgesStore((s) => s.edges)
  const addEdge = useEdgesStore((s) => s.addEdge)
  const markEditing = useCanvasStore((s) => s.markEditing)

  const [skipNoAudio, setSkipNoAudio] = useState(false)
  const [skipNoVideo, setSkipNoVideo] = useState(false)
  const [starting, setStarting] = useState(false)
  const [inferred, setInferred] = useState<InferredEdge[]>([])
  const [showInferredDialog, setShowInferredDialog] = useState(false)

  const shots = useMemo<ShotRow[]>(() => {
    return nodes
      .filter((n) => n.type === 'storyboard' && !n.hidden)
      .map((n) => {
        const d = (n.data ?? {}) as StoryboardData
        return {
          nodeId: n.id,
          shotIndex: d.shotIndex ?? 0,
          title: d.title || '未命名分镜',
          duration: d.duration ?? 5,
          hasImage: !!(d.images && d.images[0]),
          hasAudio: !!d.audioUrl,
          hasVideo: !!d.videoUrl,
        }
      })
      .sort((a, b) => a.shotIndex - b.shotIndex)
  }, [nodes])

  const totalDuration = shots.reduce((sum, s) => sum + s.duration, 0)
  const issues = useMemo(() => {
    const noImage: number[] = []
    const noAudio: number[] = []
    shots.forEach((s) => {
      if (!s.hasImage) noImage.push(s.shotIndex)
      if (!s.hasAudio) noAudio.push(s.shotIndex)
    })
    return { noImage, noAudio }
  }, [shots])

  const hasShots = shots.length > 0

  const triggerRun = useCallback(async () => {
    if (!canvasId) return
    setStarting(true)
    try {
      const result = await canvasApi.run(canvasId)
      toast.success('已提交生成任务', { description: `runId: ${result.run_id.slice(-8)}` })
      onStart(result.run_id)
      onOpenChange(false)
    } catch (err) {
      toast.error('触发失败', { description: (err as Error)?.message })
    } finally {
      setStarting(false)
    }
  }, [canvasId, onOpenChange, onStart])

  const handleStart = useCallback(async () => {
    if (!canvasId || starting) return
    if (!hasShots) {
      toast.info('请至少添加一个分镜')
      return
    }
    const inf = inferAutoEdges(nodes, edges)
    if (inf.length > 0) {
      setInferred(inf)
      setShowInferredDialog(true)
      return
    }
    await triggerRun()
  }, [canvasId, edges, hasShots, nodes, starting, triggerRun])

  const handleInferredConfirm = useCallback(
    async (persist: boolean) => {
      if (persist) {
        inferred.forEach((e) => {
          addEdge({
            id: `edge_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
            source: e.source,
            target: e.target,
            type: 'narrative',
            data: {
              edge_kind: 'narrative',
              relation_type: e.relation_type,
            },
          })
        })
        markEditing()
      }
      setShowInferredDialog(false)
      await triggerRun()
    },
    [addEdge, inferred, markEditing, triggerRun],
  )

  const nodesById = useMemo(() => {
    return new Map(nodes.map((n) => [n.id, n]))
  }, [nodes])

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent layout="panel" className="max-w-2xl">
          <DialogHeaderBar>
            <DialogTitle className="flex items-center gap-2">
              <Film className="size-5 text-accent" />
              生成成片
            </DialogTitle>
            <p className="mt-1 text-xs text-text-2">
              本次将合成 {shots.length} 个镜头，预计 {totalDuration} 秒
            </p>
          </DialogHeaderBar>

          <DialogMain className="space-y-4">
            <div className="max-h-64 overflow-y-auto rounded-md border border-border">
              {shots.length === 0 ? (
                <div className="flex h-32 items-center justify-center text-sm text-text-3">
                  画布上没有分镜节点
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="border-b border-border bg-bg-2 text-xs text-text-3">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">#</th>
                      <th className="px-3 py-2 text-left font-medium">标题</th>
                      <th className="px-3 py-2 text-right font-medium">时长</th>
                      <th className="px-3 py-2 text-center font-medium">图</th>
                      <th className="px-3 py-2 text-center font-medium">音</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shots.map((s) => (
                      <tr key={s.nodeId} className="border-b border-border last:border-b-0">
                        <td className="px-3 py-2 font-mono text-text-3">
                          #{s.shotIndex || '?'}
                        </td>
                        <td className="px-3 py-2 text-text-0">{s.title}</td>
                        <td className="px-3 py-2 text-right font-mono text-text-2">
                          {s.duration}s
                        </td>
                        <td className="px-3 py-2 text-center">
                          {s.hasImage ? (
                            <CheckCircle2 className="mx-auto size-4 text-success" />
                          ) : (
                            <AlertTriangle className="mx-auto size-4 text-warning" />
                          )}
                        </td>
                        <td className="px-3 py-2 text-center">
                          {s.hasAudio ? (
                            <Volume2 className="mx-auto size-4 text-success" />
                          ) : (
                            <span className="text-text-3">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {issues.noImage.length > 0 && (
              <div className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning-bg p-2.5 text-xs text-warning">
                <ImageIcon className="mt-0.5 size-4 shrink-0" />
                <div>
                  第 {issues.noImage.join('、')} 号镜头尚未生成画面，
                  合成时将留黑帧；建议先用「构想画面」补齐
                </div>
              </div>
            )}

            <div className="space-y-1.5 text-sm">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={skipNoAudio}
                  onChange={(e) => setSkipNoAudio(e.target.checked)}
                  className="size-4 accent-[var(--color-accent)]"
                />
                <span className="text-text-1">跳过未配音的镜头</span>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={skipNoVideo}
                  onChange={(e) => setSkipNoVideo(e.target.checked)}
                  className="size-4 accent-[var(--color-accent)]"
                />
                <span className="text-text-1">跳过未生成镜头视频的镜头</span>
              </label>
            </div>
          </DialogMain>

          <DialogActions>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button onClick={handleStart} disabled={!hasShots || starting}>
              {starting ? (
                <>
                  <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                  触发中…
                </>
              ) : (
                <>
                  <Film className="mr-1.5 size-3.5" />
                  开始生成
                </>
              )}
            </Button>
          </DialogActions>
        </DialogContent>
      </Dialog>

      <AutoEdgePreviewDialog
        open={showInferredDialog}
        onOpenChange={setShowInferredDialog}
        inferred={inferred}
        nodesById={nodesById}
        onConfirm={handleInferredConfirm}
        onCancel={() => setShowInferredDialog(false)}
      />
    </>
  )
}
