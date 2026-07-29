'use client'

import { memo, useCallback, useRef } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import {
  Copy,
  ImagePlus,
  Loader2,
  MoreHorizontal,
  Play,
  Plus,
  Trash2,
  Upload,
  Wand2,
} from 'lucide-react'
import { toast } from 'sonner'

import { cn } from '@/lib/cn'
import { canvasApi } from '@/lib/canvas/api/canvas'
import { useRunPolling } from '@/lib/canvas/hooks/useRunPolling'
import {
  useCanvasStore,
  useHistoryStore,
  useNodesStore,
  useRuntimeStore,
  useUiStore,
  type FlowNode,
} from '@/lib/canvas/store'
import { cryptoRandomId, findFreePosition } from '../editor/_utils'
import {
  DRAMACLAW_NODE_DEFINITION_MAP,
  DRAMACLAW_NODE_TYPES,
  isDramaClawNodeType,
  type DramaClawNodeDefinition,
} from './registry'

const EMPTY_LINES = ['角色', '场景', '构图', '动作', '光线']

function firstString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

function numberValue(value: unknown, fallback: number) {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function firstMedia(data: Record<string, unknown>) {
  const images = arrayValue(data.images)
  return firstString(
    data.imageUrl,
    data.previewImageUrl,
    images[0],
    data.thumbnailUrl,
    data.thumbnail_url,
  )
}

function currentTitle(definition: DramaClawNodeDefinition, data: Record<string, unknown>) {
  return firstString(data.displayName, data.title, data.label, data.name) || definition.label
}

function duplicateNode(node: FlowNode) {
  useHistoryStore.getState().push()
  useNodesStore.getState().addNode({
    ...node,
    id: `node_${cryptoRandomId()}`,
    position: { x: node.position.x + 42, y: node.position.y + 42 },
    selected: false,
    data: structuredClone(node.data ?? {}),
  })
}

function downloadUrl(url: string, fallbackName: string) {
  const link = document.createElement('a')
  link.href = url
  link.download = fallbackName
  link.rel = 'noopener'
  document.body.appendChild(link)
  link.click()
  link.remove()
}

function DramaClawNodeComponent({ id, type, data, selected }: NodeProps) {
  const nodeType = isDramaClawNodeType(type) ? type : DRAMACLAW_NODE_TYPES.imageEdit
  const definition = DRAMACLAW_NODE_DEFINITION_MAP[nodeType]
  const nodeData = (data ?? {}) as Record<string, unknown>
  const updateNodeData = useNodesStore((s) => s.updateNodeData)
  const deleteNode = useNodesStore((s) => s.deleteNode)
  const setSelectedNodeId = useUiStore((s) => s.setSelectedNodeId)
  const openNodeContextMenu = useUiStore((s) => s.openNodeContextMenu)
  const runState = useRuntimeStore((s) => s.nodeStates[id])
  const runPolling = useRunPolling()
  const isRunning = Boolean(nodeData.isGenerating) || runState?.status === 'running' || runState?.status === 'queued'
  const title = currentTitle(definition, nodeData)

  const patch = useCallback((next: Record<string, unknown>) => updateNodeData(id, next), [id, updateNodeData])

  const currentNode = useNodesStore((s) => s.nodes.find((node) => node.id === id))

  return (
    <div
      data-node-id={id}
      data-drama-claw-node={nodeType}
      className={cn(
        'drama-claw-node group',
        selected && 'is-selected',
        isRunning && 'is-running',
      )}
      style={{
        '--node-accent': definition.accent,
        width: definition.defaultSize.width,
        minHeight: definition.defaultSize.height,
      } as React.CSSProperties}
      onClick={(event) => {
        event.stopPropagation()
        setSelectedNodeId(id)
      }}
    >
      <Handle type="target" position={Position.Left} id="in:any" className="drama-claw-handle" />
      <Handle type="source" position={Position.Right} id="out:any" className="drama-claw-handle" />

      <div className="drama-claw-node-glow" />
      <header className="drama-claw-node-header">
        <span className="drama-claw-node-icon"><definition.icon size={15} /></span>
        <span className="min-w-0 flex-1 truncate">{title}</span>
        <span className="drama-claw-node-kind">{definition.label}</span>
        {isRunning ? <Loader2 size={14} className="animate-spin text-text-2" /> : null}
        <button
          type="button"
          className="drama-claw-icon-button"
          aria-label="更多节点操作"
          onClick={(event) => {
            event.stopPropagation()
            openNodeContextMenu({ nodeId: id, nodeType, x: event.clientX, y: event.clientY })
          }}
        >
          <MoreHorizontal size={15} />
        </button>
      </header>

      <NodeBody nodeId={id} nodeType={nodeType} data={nodeData} patch={patch} running={isRunning} />

      <footer className="drama-claw-node-footer">
        <button
          type="button"
          className="drama-claw-node-action"
          onClick={(event) => {
            event.stopPropagation()
            void generateForNode(id, nodeType, nodeData, patch, runPolling.start)
          }}
          disabled={isRunning}
        >
          {isRunning ? <Loader2 size={13} className="animate-spin" /> : <Wand2 size={13} />}
          <span>{isRunning ? '生成中' : actionLabelFor(nodeType)}</span>
        </button>
        <button
          type="button"
          className="drama-claw-node-mini-action"
          aria-label="复制节点"
          onClick={(event) => {
            event.stopPropagation()
            if (currentNode) duplicateNode(currentNode)
          }}
        >
          <Copy size={13} />
        </button>
        <button
          type="button"
          className="drama-claw-node-mini-action is-danger"
          aria-label="删除节点"
          onClick={(event) => {
            event.stopPropagation()
            useHistoryStore.getState().push()
            deleteNode(id)
            toast('已删除 1 个节点')
          }}
        >
          <Trash2 size={13} />
        </button>
      </footer>
    </div>
  )
}

function NodeBody({
  nodeId,
  nodeType,
  data,
  patch,
  running,
}: {
  nodeId: string
  nodeType: string
  data: Record<string, unknown>
  patch: (next: Record<string, unknown>) => void
  running: boolean
}) {
  if (nodeType === DRAMACLAW_NODE_TYPES.upload) {
    return <UploadNodeBody data={data} patch={patch} />
  }
  if (
    nodeType === DRAMACLAW_NODE_TYPES.imageEdit ||
    nodeType === DRAMACLAW_NODE_TYPES.imageGen ||
    nodeType === DRAMACLAW_NODE_TYPES.exportImage ||
    nodeType === DRAMACLAW_NODE_TYPES.pano360Viewer
  ) {
    return <ImageNodeBody nodeType={nodeType} data={data} patch={patch} running={running} />
  }
  if (nodeType === DRAMACLAW_NODE_TYPES.video) return <VideoNodeBody data={data} patch={patch} />
  if (nodeType === DRAMACLAW_NODE_TYPES.audio) return <AudioNodeBody data={data} patch={patch} />
  if (nodeType === DRAMACLAW_NODE_TYPES.textAnnotation) return <TextNodeBody data={data} patch={patch} />
  if (nodeType === DRAMACLAW_NODE_TYPES.beatContext) return <BeatContextBody data={data} patch={patch} />
  if (nodeType === DRAMACLAW_NODE_TYPES.storyboardSplit || nodeType === DRAMACLAW_NODE_TYPES.storyboardGen) {
    return <StoryboardBody nodeId={nodeId} data={data} patch={patch} />
  }
  if (nodeType === DRAMACLAW_NODE_TYPES.script) return <ScriptBody data={data} patch={patch} />
  if (nodeType === DRAMACLAW_NODE_TYPES.videoCompose || nodeType === DRAMACLAW_NODE_TYPES.videoStory) {
    return <ComposeBody data={data} patch={patch} story={nodeType === DRAMACLAW_NODE_TYPES.videoStory} />
  }
  if (nodeType === DRAMACLAW_NODE_TYPES.threeDWorld) return <ThreeDBody data={data} patch={patch} />
  if (nodeType === DRAMACLAW_NODE_TYPES.skill) return <SkillBody data={data} patch={patch} />
  return <GroupBody data={data} patch={patch} />
}

function UploadNodeBody({ data, patch }: { data: Record<string, unknown>; patch: (next: Record<string, unknown>) => void }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const src = firstMedia(data)
  const videoUrl = firstString(data.videoUrl)
  const audioUrl = firstString(data.audioUrl, data.url)

  const readFile = (file: File) => {
    const reader = new FileReader()
    reader.onload = () => {
      const value = String(reader.result || '')
      if (file.type.startsWith('video/')) patch({ videoUrl: value, sourceFileName: file.name, displayName: file.name })
      else if (file.type.startsWith('audio/')) patch({ audioUrl: value, url: value, sourceFileName: file.name, displayName: file.name })
      else patch({ imageUrl: value, previewImageUrl: value, sourceFileName: file.name, displayName: file.name })
    }
    reader.readAsDataURL(file)
  }

  return (
    <div className="drama-claw-upload-body">
      <input
        ref={inputRef}
        type="file"
        accept="image/*,video/*,audio/*"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) readFile(file)
        }}
      />
      <button
        type="button"
        className="drama-claw-dropzone"
        onClick={() => inputRef.current?.click()}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault()
          const file = event.dataTransfer.files?.[0]
          if (file) readFile(file)
        }}
      >
        {videoUrl ? <video src={videoUrl} className="drama-claw-media" controls /> : src ? <img src={src} alt="" className="drama-claw-media" /> : audioUrl ? <audio src={audioUrl} controls className="w-full" /> : (
          <>
            <Upload size={26} />
            <span>点击或拖入素材</span>
          </>
        )}
      </button>
    </div>
  )
}

function ImageNodeBody({
  nodeType,
  data,
  patch,
  running,
}: {
  nodeType: string
  data: Record<string, unknown>
  patch: (next: Record<string, unknown>) => void
  running: boolean
}) {
  const src = firstMedia(data)
  const batch = arrayValue(data.generationBatch).filter((item): item is string => typeof item === 'string')
  return (
    <div className="drama-claw-body">
      <div className="drama-claw-preview">
        {src ? (
          <img src={src} alt={firstString(data.displayName, data.title, data.label) || 'image'} />
        ) : (
          <div className="drama-claw-empty-preview">
            <ImagePlus size={30} />
            <span>{nodeType === DRAMACLAW_NODE_TYPES.pano360Viewer ? '添加全景图' : '等待图片'}</span>
          </div>
        )}
        {running ? <div className="drama-claw-generating"><Loader2 size={18} className="animate-spin" />正在生成</div> : null}
      </div>
      {batch.length > 1 ? (
        <div className="drama-claw-result-strip">
          {batch.map((url) => (
            <button key={url} type="button" onClick={() => patch({ imageUrl: url, previewImageUrl: url })}>
              <img src={url} alt="" />
            </button>
          ))}
        </div>
      ) : null}
      <PromptArea value={firstString(data.prompt, data.content)} onChange={(prompt) => patch({ prompt })} placeholder="描述画面、角色、风格、构图..." />
      <div className="drama-claw-param-row">
        <Chip active>{firstString(data.model) || 'default'}</Chip>
        <Chip>{firstString(data.aspectRatio, data.requestAspectRatio) || 'auto'}</Chip>
        <Chip>{firstString(data.size) || '2K'}</Chip>
      </div>
    </div>
  )
}

function VideoNodeBody({ data, patch }: { data: Record<string, unknown>; patch: (next: Record<string, unknown>) => void }) {
  const videoUrl = firstString(data.videoUrl, data.resultVideoUrl, data.url)
  return (
    <div className="drama-claw-body">
      <div className="drama-claw-preview is-video">
        {videoUrl ? <video src={videoUrl} controls playsInline /> : <div className="drama-claw-empty-preview"><Play size={30} /><span>视频生成 / 引用</span></div>}
      </div>
      <PromptArea value={firstString(data.prompt)} onChange={(prompt) => patch({ prompt })} placeholder="描述运动、镜头、节奏..." />
      <div className="drama-claw-param-row">
        <Chip active>{firstString(data.genMode) || 'textToVideo'}</Chip>
        <Chip>{firstString(data.quality) || '720P'}</Chip>
        <Chip>{numberValue(data.durationSec, 5)}s</Chip>
      </div>
    </div>
  )
}

function AudioNodeBody({ data, patch }: { data: Record<string, unknown>; patch: (next: Record<string, unknown>) => void }) {
  const audioUrl = firstString(data.audioUrl, data.url)
  return (
    <div className="drama-claw-body">
      <div className="drama-claw-waveform">
        {Array.from({ length: 36 }).map((_, index) => (
          <span key={index} style={{ height: `${18 + ((index * 17) % 38)}px` }} />
        ))}
      </div>
      {audioUrl ? <audio src={audioUrl} controls className="w-full" /> : null}
      <PromptArea value={firstString(data.text, data.prompt)} onChange={(text) => patch({ text, prompt: text })} placeholder="输入旁白、台词或音乐描述..." />
      <div className="drama-claw-param-row">
        <Chip active>{firstString(data.audioKind) || 'voice'}</Chip>
        <Chip>{firstString(data.voice) || '默认音色'}</Chip>
      </div>
    </div>
  )
}

function TextNodeBody({ data, patch }: { data: Record<string, unknown>; patch: (next: Record<string, unknown>) => void }) {
  return (
    <div className="drama-claw-body">
      <textarea
        value={firstString(data.content)}
        onChange={(event) => patch({ content: event.target.value })}
        placeholder="写下想法、提示词、旁白或要反推的内容..."
        className="drama-claw-large-textarea"
      />
      <div className="drama-claw-param-row">
        <Chip active>{firstString(data.mode) || 'writing'}</Chip>
        <Chip>{firstString(data.model) || 'default'}</Chip>
      </div>
    </div>
  )
}

function BeatContextBody({ data, patch }: { data: Record<string, unknown>; patch: (next: Record<string, unknown>) => void }) {
  const snapshot = data.snapshot && typeof data.snapshot === 'object' ? data.snapshot as Record<string, unknown> : {}
  return (
    <div className="drama-claw-body">
      <PromptArea
        value={firstString(data.content, snapshot.visualDescription)}
        onChange={(content) => patch({ content, snapshot: { ...snapshot, visualDescription: content } })}
        placeholder="当前镜头视觉描述、角色状态、场景约束..."
      />
      <div className="drama-claw-context-grid">
        {EMPTY_LINES.map((label) => <span key={label}>{label}</span>)}
      </div>
      <div className="drama-claw-param-row">
        <Chip active>{firstString(data.syncStatus) || 'fresh'}</Chip>
        <Chip>mainline context</Chip>
      </div>
    </div>
  )
}

function StoryboardBody({
  nodeId,
  data,
  patch,
}: {
  nodeId: string
  data: Record<string, unknown>
  patch: (next: Record<string, unknown>) => void
}) {
  const rows = numberValue(data.gridRows, 2)
  const cols = numberValue(data.gridCols, 2)
  const frames = arrayValue(data.frames)
  const cells = Math.max(1, Math.min(rows * cols, 12))
  return (
    <div className="drama-claw-body">
      <div className="drama-claw-storyboard-grid" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
        {Array.from({ length: cells }).map((_, index) => {
          const frame = frames[index] && typeof frames[index] === 'object' ? frames[index] as Record<string, unknown> : null
          const url = firstString(frame?.imageUrl, frame?.url)
          return (
            <button key={index} type="button" onClick={() => useUiStore.getState().setSelectedNodeId(nodeId)}>
              {url ? <img src={url} alt="" /> : <span>{index + 1}</span>}
            </button>
          )
        })}
      </div>
      <PromptArea value={firstString(data.prompt, data.content)} onChange={(prompt) => patch({ prompt })} placeholder="描述这一组分镜..." />
      <div className="drama-claw-param-row">
        <button type="button" className="drama-claw-chip" onClick={() => patch({ gridRows: Math.max(1, rows - 1) })}>- 行</button>
        <Chip active>{rows} x {cols}</Chip>
        <button type="button" className="drama-claw-chip" onClick={() => patch({ gridRows: Math.min(4, rows + 1) })}>+ 行</button>
        <button type="button" className="drama-claw-chip" onClick={() => patch({ gridCols: Math.min(4, cols + 1) })}>+ 列</button>
      </div>
    </div>
  )
}

function ScriptBody({ data, patch }: { data: Record<string, unknown>; patch: (next: Record<string, unknown>) => void }) {
  return (
    <div className="drama-claw-body">
      <input
        value={firstString(data.title, data.displayName)}
        onChange={(event) => patch({ title: event.target.value, displayName: event.target.value })}
        className="drama-claw-title-input"
        placeholder="脚本标题"
      />
      <textarea
        value={firstString(data.content)}
        onChange={(event) => patch({ content: event.target.value })}
        className="drama-claw-large-textarea"
        placeholder="镜头 / 角色 / 台词 / 动作..."
      />
    </div>
  )
}

function ComposeBody({ data, patch, story }: { data: Record<string, unknown>; patch: (next: Record<string, unknown>) => void; story: boolean }) {
  const clips = arrayValue(data.clips)
  return (
    <div className="drama-claw-body">
      <div className="drama-claw-timeline">
        {(clips.length ? clips : [0, 1, 2]).map((clip, index) => (
          <span key={index} style={{ width: `${70 + index * 28}px` }}>
            {story ? `Story ${index + 1}` : `Clip ${index + 1}`}
          </span>
        ))}
      </div>
      <PromptArea value={firstString(data.summary, data.prompt)} onChange={(summary) => patch({ summary, prompt: summary })} placeholder="合成目标、节奏、字幕、音乐..." />
      <div className="drama-claw-param-row">
        <Chip active>{firstString(data.resolution) || '1080p'}</Chip>
        <Chip>{story ? 'story mode' : 'timeline'}</Chip>
        <Chip>{clips.length || 0} clips</Chip>
      </div>
    </div>
  )
}

function ThreeDBody({ data, patch }: { data: Record<string, unknown>; patch: (next: Record<string, unknown>) => void }) {
  return (
    <div className="drama-claw-body">
      <div className="drama-claw-3d-preview">
        <OrbitShape />
        <span>导演世界 / 3D 场景</span>
      </div>
      <PromptArea value={firstString(data.prompt, data.sourceUrl)} onChange={(prompt) => patch({ prompt })} placeholder="场景结构、模型、摄像机、灯光..." />
    </div>
  )
}

function SkillBody({ data, patch }: { data: Record<string, unknown>; patch: (next: Record<string, unknown>) => void }) {
  return (
    <div className="drama-claw-body">
      <input
        value={firstString(data.skillId, data.displayName)}
        onChange={(event) => patch({ skillId: event.target.value, displayName: event.target.value || '技能' })}
        className="drama-claw-title-input"
        placeholder="选择或输入技能 ID"
      />
      <PromptArea value={firstString(data.prompt)} onChange={(prompt) => patch({ prompt })} placeholder="技能入参、约束、输出要求..." />
      <div className="drama-claw-param-row">
        <Chip active>{firstString(data.status) || 'idle'}</Chip>
        <Chip>inputs</Chip>
        <Chip>outputs</Chip>
      </div>
    </div>
  )
}

function GroupBody({ data, patch }: { data: Record<string, unknown>; patch: (next: Record<string, unknown>) => void }) {
  return (
    <div className="drama-claw-body">
      <input
        value={firstString(data.label, data.displayName)}
        onChange={(event) => patch({ label: event.target.value, displayName: event.target.value })}
        className="drama-claw-title-input"
        placeholder="组名称"
      />
      <div className="drama-claw-group-placeholder">
        <Plus size={18} />
        <span>拖入节点形成组</span>
      </div>
    </div>
  )
}

function PromptArea({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder: string }) {
  return (
    <textarea
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      className="drama-claw-prompt nodrag"
    />
  )
}

function Chip({ children, active }: { children: React.ReactNode; active?: boolean }) {
  return <span className={cn('drama-claw-chip', active && 'is-active')}>{children}</span>
}

function OrbitShape() {
  return (
    <div className="drama-claw-orbit" aria-hidden>
      <span />
      <span />
      <span />
    </div>
  )
}

function actionLabelFor(nodeType: string) {
  if (nodeType === DRAMACLAW_NODE_TYPES.video) return '生成视频'
  if (nodeType === DRAMACLAW_NODE_TYPES.audio) return '生成音频'
  if (nodeType === DRAMACLAW_NODE_TYPES.script) return '整理脚本'
  if (nodeType === DRAMACLAW_NODE_TYPES.videoCompose) return '合成'
  if (nodeType === DRAMACLAW_NODE_TYPES.videoStory) return '生成故事'
  if (nodeType === DRAMACLAW_NODE_TYPES.storyboardGen) return '生成分镜'
  if (nodeType === DRAMACLAW_NODE_TYPES.skill) return '执行技能'
  return '生成'
}

function targetNodeTypeFor(nodeType: string) {
  if (nodeType === DRAMACLAW_NODE_TYPES.video || nodeType === DRAMACLAW_NODE_TYPES.videoCompose || nodeType === DRAMACLAW_NODE_TYPES.videoStory) {
    return DRAMACLAW_NODE_TYPES.video
  }
  if (nodeType === DRAMACLAW_NODE_TYPES.audio) return DRAMACLAW_NODE_TYPES.audio
  if (nodeType === DRAMACLAW_NODE_TYPES.storyboardGen || nodeType === DRAMACLAW_NODE_TYPES.storyboardSplit) return DRAMACLAW_NODE_TYPES.storyboardGen
  if (nodeType === DRAMACLAW_NODE_TYPES.exportImage) return DRAMACLAW_NODE_TYPES.exportImage
  if (nodeType === DRAMACLAW_NODE_TYPES.pano360Viewer) return DRAMACLAW_NODE_TYPES.pano360Viewer
  return DRAMACLAW_NODE_TYPES.imageEdit
}

async function generateForNode(
  nodeId: string,
  nodeType: string,
  data: Record<string, unknown>,
  patch: (next: Record<string, unknown>) => void,
  startRunPolling: (hiddenNodeId: string, runId?: string) => void,
) {
  const canvasId = useCanvasStore.getState().canvasId
  if (!canvasId) return
  const prompt = firstString(data.prompt, data.content, data.text, data.summary, data.title)
  if (!prompt) {
    toast.info('请先填写描述内容')
    return
  }
  patch({ isGenerating: true, generationStartedAt: Date.now(), generationError: null })
  try {
    const actionLabel = actionLabelFor(nodeType)
    const targetNodeType = targetNodeTypeFor(nodeType)
    const nodesStore = useNodesStore.getState()
    const sourceNode = nodesStore.nodes.find((node) => node.id === nodeId)
    const sourceDefinition = isDramaClawNodeType(nodeType)
      ? DRAMACLAW_NODE_DEFINITION_MAP[nodeType]
      : DRAMACLAW_NODE_DEFINITION_MAP[DRAMACLAW_NODE_TYPES.imageEdit]
    const sourceWidth = typeof sourceNode?.width === 'number'
      ? sourceNode.width
      : sourceDefinition.defaultSize.width
    const targetPosition = findFreePosition(
      {
        x: (sourceNode?.position.x ?? 120) + sourceWidth + 96,
        y: sourceNode?.position.y ?? 120,
      },
      nodesStore.nodes,
    )
    const result = await canvasApi.triggerBusinessAction(canvasId, {
      actionLabel,
      sourceNodeId: nodeId,
      sourceNodeDefId: nodeType,
      userInput: prompt,
      output_mode: 'insert_new_node',
      target_node_type: targetNodeType as never,
      position_x: Math.round(targetPosition.x),
      position_y: Math.round(targetPosition.y),
    })
    if (result.node) {
      const node = result.node as unknown as FlowNode
      nodesStore.addNode({
        ...node,
        id: node.id || `node_${cryptoRandomId()}`,
        type: targetNodeType,
        data: {
          ...(node.data ?? {}),
          displayName: `${actionLabel}结果`,
        },
      })
    }
    startRunPolling(result.hidden_node_id, result.run_id)
    toast.success(result.deduplicated ? '该任务已在队列中' : result.queued ? '已加入生成队列' : '已开始生成')
  } catch (error) {
    patch({ generationError: error instanceof Error ? error.message : '生成失败' })
    toast.error(error instanceof Error ? error.message : '生成失败')
  } finally {
    patch({ isGenerating: false })
  }
}

export const DramaClawNode = memo(DramaClawNodeComponent)
