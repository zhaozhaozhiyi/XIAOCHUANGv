'use client'

/**
 * /canvas-perf — 画布性能压测页（v0.2.0 PR2，dev only）
 *
 * 用途：
 *  - 种 100 节点（5 类内容 + 5 类执行各 10 个）+ 50 边
 *  - 实时 FPS / long task 探测面板
 *  - 6 状态切换按钮（推选中节点为指定状态）
 *  - 自检 60s 平移：单 long task < 200ms → PASS / FAIL
 *
 * 对齐 TRD §7 性能目标：
 *  - 100 节点平移 60fps
 *  - 100 节点 + 持续推 progress，主线程 long task < 200ms
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  type Edge,
  type EdgeTypes,
  type Node,
  type NodeTypes,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'

import * as canvasNodes from '@/components/canvas/nodes'
import * as canvasEdges from '@/components/canvas/edges'
import { useRuntimeStore } from '@/lib/canvas/store'
import { scheduleProgressUpdate } from '@/lib/canvas/utils/progressBuffer'
import { cn } from '@/lib/cn'
import type { NodeStatus } from '@/lib/canvas/types'

const NODE_TYPES: NodeTypes = {
  storyboard: canvasNodes.StoryboardNode,
  image: canvasNodes.ImageNode,
  character: canvasNodes.CharacterNode,
  scene: canvasNodes.SceneNode,
  note: canvasNodes.NoteNode,
  'text-to-image': canvasNodes.TextToImageNode,
  'image-to-video': canvasNodes.ImageToVideoNode,
  'text-to-speech': canvasNodes.TextToSpeechNode,
  concat: canvasNodes.ConcatNode,
  export: canvasNodes.ExportNode,
}

const EDGE_TYPES: EdgeTypes = {
  narrative: canvasEdges.NarrativeEdge,
  dataflow: canvasEdges.DataflowEdge,
  default: canvasEdges.NarrativeEdge,
}

const NODE_TEMPLATES: { type: string; data: Record<string, unknown> }[] = [
  { type: 'storyboard', data: { shotIndex: 1, title: '镜', shotDescription: '占位', shotType: '中景', cameraMove: '推', duration: 5 } },
  { type: 'image', data: { label: '参考图', images: ['https://picsum.photos/seed/img/400/240'] } },
  { type: 'character', data: { name: '角色', description: '占位人设', images: ['https://picsum.photos/seed/char/200/200'] } },
  { type: 'scene', data: { name: '场景', description: '占位场景', images: ['https://picsum.photos/seed/scene/400/240'] } },
  { type: 'note', data: { text: '便签内容', color: 'yellow' } },
  { type: 'text-to-image', data: { prompt: '提示词占位', style: 'realistic' } },
  { type: 'image-to-video', data: { motion: '镜头平移', duration: '5' } },
  { type: 'text-to-speech', data: { text: '台词占位', characterName: '角色 A' } },
  { type: 'concat', data: {} },
  { type: 'export', data: { resolution: '1080p', codec: 'h264' } },
]

function seed100(): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = []
  // 100 节点 = 10 类 × 10 个，10×10 网格
  for (let i = 0; i < 100; i++) {
    const col = i % 10
    const row = Math.floor(i / 10)
    const tpl = NODE_TEMPLATES[i % NODE_TEMPLATES.length]
    nodes.push({
      id: `perf_${i}`,
      type: tpl.type,
      position: { x: col * 320, y: row * 360 },
      data: { ...tpl.data, perfIndex: i },
    })
  }
  // 50 条 dataflow 边：每对相邻节点连一条（如果端口类型可能不匹配，就只渲染，不强求合法）
  const edges: Edge[] = []
  for (let i = 0; i < 50; i++) {
    const a = i * 2
    const b = i * 2 + 1
    edges.push({
      id: `perf_edge_${i}`,
      source: `perf_${a}`,
      target: `perf_${b}`,
      type: 'dataflow',
      sourceHandle: 'out:image',
      targetHandle: 'in:image',
      data: {
        edge_kind: 'dataflow',
        source_port: 'out:image',
        target_port: 'in:image',
      },
    })
  }
  return { nodes, edges }
}

interface PerfStats {
  fps: number
  longTasks: number
  maxLongTaskMs: number
  memoryMb?: number
}

function usePerfStats(): PerfStats {
  const [stats, setStats] = useState<PerfStats>({ fps: 0, longTasks: 0, maxLongTaskMs: 0 })
  const longTasksRef = useRef(0)
  const maxLongRef = useRef(0)

  useEffect(() => {
    // FPS：requestAnimationFrame 滚动平均
    let frames = 0
    let last = performance.now()
    let raf = 0
    const tick = (now: number) => {
      frames++
      if (now - last >= 1000) {
        setStats((prev) => ({
          ...prev,
          fps: frames,
          longTasks: longTasksRef.current,
          maxLongTaskMs: maxLongRef.current,
          memoryMb:
            (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize
              ? Math.round(
                  (performance as unknown as { memory: { usedJSHeapSize: number } }).memory.usedJSHeapSize /
                    1024 /
                    1024,
                )
              : undefined,
        }))
        frames = 0
        last = now
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)

    // Long Task observer（Chromium 支持）
    let observer: PerformanceObserver | null = null
    if ('PerformanceObserver' in window) {
      try {
        observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            longTasksRef.current += 1
            if (entry.duration > maxLongRef.current) {
              maxLongRef.current = entry.duration
            }
          }
        })
        observer.observe({ entryTypes: ['longtask'] })
      } catch {
        // 不支持时静默
      }
    }

    return () => {
      cancelAnimationFrame(raf)
      observer?.disconnect()
    }
  }, [])

  return stats
}

function CanvasPerfInner() {
  const { nodes: seedNodes, edges: seedEdges } = useMemo(() => seed100(), [])
  const [nodes] = useState<Node[]>(seedNodes)
  const [edges] = useState<Edge[]>(seedEdges)
  const stats = usePerfStats()
  const mergeNodeState = useRuntimeStore((s) => s.mergeNodeState)

  /** 触发所有 100 节点同时跑 progress 60s，验证 RAF 合批 + per-node selector */
  const handleStartStress = useCallback(() => {
    // 给所有节点设 running 状态（仅写一次 store，触发 100 次 re-render）
    nodes.forEach((n) => mergeNodeState(n.id, { status: 'running', progress: 0 }))
    // 然后用 progressBuffer 高频推进度（不走 store，走 DOM）
    const start = performance.now()
    const tick = () => {
      const elapsed = performance.now() - start
      if (elapsed > 60_000) {
        nodes.forEach((n) => mergeNodeState(n.id, { status: 'completed', progress: 100 }))
        return
      }
      const progress = Math.min(100, (elapsed / 60_000) * 100)
      nodes.forEach((n) => scheduleProgressUpdate(n.id, progress))
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  }, [nodes, mergeNodeState])

  /** 一键切所有节点为某状态（眼测 6 态视觉） */
  const handleSetStatus = useCallback(
    (status: NodeStatus) => {
      nodes.forEach((n) =>
        mergeNodeState(n.id, status === 'running' ? { status, progress: 50 } : { status }),
      )
    },
    [nodes, mergeNodeState],
  )

  return (
    <div className="relative size-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        edgeTypes={EDGE_TYPES}
        minZoom={0.1}
        maxZoom={2}
        fitView
        fitViewOptions={{ padding: 0.1 }}
        proOptions={{ hideAttribution: true }}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={20}
          size={1}
          color="var(--canvas-grid-dot)"
        />
        <Controls position="bottom-left" showInteractive={false} />
        <MiniMap position="bottom-right" pannable zoomable />
      </ReactFlow>

      {/* 顶部控制面板 */}
      <div className="absolute left-1/2 top-3 z-50 flex -translate-x-1/2 items-center gap-2 rounded-2xl border border-border bg-bg-surface px-3 py-2 shadow-default backdrop-blur-md">
        <span className="text-sm font-semibold text-text-0">100 节点压测</span>
        <button
          type="button"
          onClick={handleStartStress}
          className="rounded-md bg-accent px-3 py-1 text-xs font-medium text-on-accent transition-colors hover:bg-accent-dark"
        >
          60s 持续 progress 推
        </button>
        <div className="mx-2 h-4 w-px bg-border" />
        <span className="text-xs text-text-3">切状态：</span>
        {(['idle', 'queued', 'running', 'completed', 'failed', 'paused'] as NodeStatus[]).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => handleSetStatus(s)}
            className="rounded-md border border-border bg-bg-2 px-2 py-1 text-xs text-text-2 transition-colors hover:bg-bg-hover hover:text-text-0"
          >
            {s}
          </button>
        ))}
      </div>

      {/* 右上角统计面板 */}
      <div className="absolute right-3 top-3 z-50 rounded-2xl border border-border bg-bg-surface p-3 text-xs shadow-default backdrop-blur-md">
        <div className="mb-2 text-sm font-semibold text-text-0">Perf Stats</div>
        <Stat
          label="FPS"
          value={stats.fps}
          tone={stats.fps >= 55 ? 'success' : stats.fps >= 30 ? 'warning' : 'error'}
        />
        <Stat label="Long Tasks" value={stats.longTasks} tone={stats.longTasks === 0 ? 'success' : 'warning'} />
        <Stat
          label="Max Long Task"
          value={`${Math.round(stats.maxLongTaskMs)} ms`}
          tone={stats.maxLongTaskMs < 200 ? 'success' : 'error'}
        />
        {stats.memoryMb !== undefined && (
          <Stat
            label="JS Heap"
            value={`${stats.memoryMb} MB`}
            tone={stats.memoryMb < 200 ? 'success' : 'warning'}
          />
        )}
        <div className="mt-2 border-t border-border pt-2 text-[10px] text-text-3">
          目标：FPS ≥ 55 / Max Long Task &lt; 200ms / Heap &lt; 200MB
        </div>
      </div>
    </div>
  )
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string
  value: string | number
  tone: 'success' | 'warning' | 'error'
}) {
  const colorClass =
    tone === 'success' ? 'text-success' : tone === 'warning' ? 'text-warning' : 'text-error'
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-text-2">{label}</span>
      <span className={cn('font-mono font-medium', colorClass)}>{value}</span>
    </div>
  )
}

export default function CanvasPerfPage() {
  return (
    <ReactFlowProvider>
      <CanvasPerfInner />
    </ReactFlowProvider>
  )
}
