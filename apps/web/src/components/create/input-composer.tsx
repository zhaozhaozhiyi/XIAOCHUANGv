'use client'

import { type ChangeEvent, type ClipboardEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import { toast } from 'sonner'
import { ArrowLeftRight, ArrowUp, ChevronDown, Image as ImageIcon, Loader2, Music2, Ratio, Sparkles, Video } from 'lucide-react'

import { InputComposerAssetPanel } from '@/components/create/input-composer-asset-panel'
import { InputComposerPreviewDialog } from '@/components/create/input-composer-preview-dialog'
import { buildComposerSubmitPayload, validateComposerSubmit } from '@/components/create/input-composer-submit'
import type { ComposerPrefill, ComposerSubmitPayload, ImageResolution, ModelSelectOption } from '@/components/create/input-composer-types'
import { useInputComposerModeState } from '@/components/create/use-input-composer-mode-state'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Textarea } from '@/components/ui/textarea'
import { audioAPI } from '@/lib/api'

const COMPOSER_CHIP_BTN =
  'inline-flex items-center gap-1.5 rounded-[8px] border border-border bg-bg-0 px-2.5 py-1.5 text-text-1 transition-colors hover:bg-bg-hover'

const IMAGE_ASPECT_RATIO_OPTIONS = [
  { label: '智能', value: 'auto' },
  { label: '21:9', value: '21:9' },
  { label: '16:9', value: '16:9' },
  { label: '3:2', value: '3:2' },
  { label: '4:3', value: '4:3' },
  { label: '1:1', value: '1:1' },
  { label: '3:4', value: '3:4' },
  { label: '2:3', value: '2:3' },
  { label: '9:16', value: '9:16' },
] as const

const MAX_IMAGE_UPLOAD_BYTES = 20 * 1024 * 1024
const VOICE_PREVIEW_TEXT = '每一种声音都有自己的故事'

interface InputComposerProps {
  submitting?: boolean
  defaultPrompt?: string
  prefill?: ComposerPrefill | null
  initialImageModelOptions?: ModelSelectOption[]
  onSubmit: (payload: ComposerSubmitPayload) => Promise<boolean | void> | boolean | void
}

function renderModelMenuItem(item: ModelSelectOption) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-0.5 pr-2">
      <span className="truncate text-sm font-medium text-text-0">{item.label}</span>
      {item.description ? (
        <span className="truncate text-xs text-text-2">{item.description}</span>
      ) : null}
      <span className="truncate font-mono text-[10px] text-text-3">{item.tertiary}</span>
    </div>
  )
}

const VideoModeControls = dynamic(
  () => import('./input-composer-video-controls').then((mod) => ({ default: mod.VideoModeControls })),
  { ssr: false, loading: () => null },
)

const AudioModeControls = dynamic(
  () => import('./input-composer-audio-controls').then((mod) => ({ default: mod.AudioModeControls })),
  { ssr: false, loading: () => null },
)

function isVideoResourceUrl(url: string) {
  const normalized = url.split('#')[0]?.split('?')[0]?.toLowerCase() ?? ''
  return normalized.endsWith('.mp4') || normalized.endsWith('.webm') || normalized.endsWith('.mov') || normalized.endsWith('.m4v')
}

function calcImageDimensions(ratio: string, resolution: ImageResolution) {
  const side = resolution === '4k' ? 4096 : 2048
  if (ratio === 'auto') return { width: side, height: side }
  const [wRaw, hRaw] = ratio.split(':').map((item) => Number(item))
  const wRatio = Number.isFinite(wRaw) && wRaw > 0 ? wRaw : 1
  const hRatio = Number.isFinite(hRaw) && hRaw > 0 ? hRaw : 1
  if (wRatio === hRatio) return { width: side, height: side }
  if (wRatio > hRatio) {
    const width = side
    const height = Math.max(256, Math.round((side * hRatio) / wRatio / 2) * 2)
    return { width, height }
  }
  const height = side
  const width = Math.max(256, Math.round((side * wRatio) / hRatio / 2) * 2)
  return { width, height }
}

export function InputComposer({
  submitting = false,
  defaultPrompt = '',
  prefill = null,
  initialImageModelOptions,
  onSubmit,
}: InputComposerProps) {
  const [pages, setPages] = useState([defaultPrompt, '', ''])
  const [activePage, setActivePage] = useState(0)
  const [uploading, setUploading] = useState(false)
  const [pastedImages, setPastedImages] = useState<Array<{ url: string; name: string }>>([])
  const [isImageStackHovered, setIsImageStackHovered] = useState(false)
  const [suppressImageStackHoverExpand, setSuppressImageStackHoverExpand] = useState(false)
  const [isImageStackManualExpanded, setIsImageStackManualExpanded] = useState(false)
  const [isCoarsePointer, setIsCoarsePointer] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const promptRef = useRef<HTMLTextAreaElement | null>(null)
  const voicePreviewAudioRef = useRef<HTMLAudioElement | null>(null)
  const promptOverlayInnerRef = useRef<HTMLDivElement | null>(null)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [referencePreviewUrl, setReferencePreviewUrl] = useState('')
  const [referencePreviewTitle, setReferencePreviewTitle] = useState('')
  const [imageUrl, setImageUrl] = useState('')
  const [firstFrameUrl, setFirstFrameUrl] = useState('')
  const [lastFrameUrl, setLastFrameUrl] = useState('')
  const [uploadTarget, setUploadTarget] = useState<'general' | 'first-frame' | 'last-frame'>('general')
  const [referenceImagesText, setReferenceImagesText] = useState('')
  const [voicePreviewing, setVoicePreviewing] = useState(false)
  const [mentionOpen, setMentionOpen] = useState(false)
  const [mentionQuery, setMentionQuery] = useState('')
  const [mentionFromIndex, setMentionFromIndex] = useState<number | null>(null)
  const [activeMentionIndex, setActiveMentionIndex] = useState(0)
  const [mentionAnchor, setMentionAnchor] = useState({ left: 12, top: 26 })
  const mentionMenuRef = useRef<HTMLDivElement | null>(null)
  const mentionUpdateRafRef = useRef<number | null>(null)
  const pendingCursorRef = useRef<number | null>(null)
  const {
    toolbarMode,
    setToolbarMode,
    toolbarModeMeta,
    imageModel,
    setImageModel,
    imageAspectRatio,
    setImageAspectRatio,
    imageResolution,
    setImageResolution,
    imageModelOptions,
    imageModelsLoading,
    videoModel,
    setVideoModel,
    videoModelOptions,
    videoModelsLoading,
    voiceOptions,
    voicesLoading,
    selectedVoiceId,
    setSelectedVoiceId,
    audioConfigOptions,
    audioConfigsLoading,
    selectedAudioConfigId,
    setSelectedAudioConfigId,
    audioSpeed,
    setAudioSpeed,
    audioEmotion,
    setAudioEmotion,
    videoReferenceMode,
    setVideoReferenceMode,
    duration,
    setDuration,
    aspectRatio,
    setAspectRatio,
    isFirstLastFrameMode,
  } = useInputComposerModeState({
    initialImageModelOptions,
    onToolbarModeChange: () => {
      setPastedImages([])
      setImageUrl('')
      setFirstFrameUrl('')
      setLastFrameUrl('')
      setReferenceImagesText('')
      setUploadTarget('general')
      setSuppressImageStackHoverExpand(false)
      setIsImageStackHovered(false)
      setIsImageStackManualExpanded(false)
      setPreviewOpen(false)
      setReferencePreviewUrl('')
      setReferencePreviewTitle('')
    },
  })

  const prompt = pages[activePage] ?? ''
  const setPrompt = useCallback((value: string) => {
    setPages((current) => {
      const next = [...current]
      next[activePage] = value
      return next
    })
  }, [activePage])

  // 外部回填（“重新编辑”）：根据 nonce 仅应用一次
  const prefillNonceRef = useRef(0)
  useEffect(() => {
    if (!prefill || prefill.nonce === prefillNonceRef.current) return
    prefillNonceRef.current = prefill.nonce
    if (prefill.toolbar_mode) setToolbarMode(prefill.toolbar_mode)
    setPrompt(prefill.prompt ?? '')
    if (prefill.aspect_ratio) {
      if (prefill.toolbar_mode === 'image') setImageAspectRatio(prefill.aspect_ratio)
      else if (prefill.toolbar_mode === 'video') setAspectRatio(prefill.aspect_ratio)
    }
    if (prefill.video_model && prefill.toolbar_mode === 'video') setVideoModel(prefill.video_model)
    if (prefill.image_model && prefill.toolbar_mode === 'image') setImageModel(prefill.image_model)
    if (prefill.audio_config_id != null && prefill.toolbar_mode === 'audio') setSelectedAudioConfigId(prefill.audio_config_id)
    window.setTimeout(() => promptRef.current?.focus(), 0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill])

  const selectedImageModelLabel = useMemo(
    () => imageModelOptions.find((item) => item.value === imageModel)?.label
      ?? (imageModelsLoading ? '加载图片模型…' : (imageModelOptions.length ? '选择图片模型' : '未配置 · 前往设置')),
    [imageModel, imageModelOptions, imageModelsLoading],
  )
  const selectedImageAspectLabel = useMemo(
    () => IMAGE_ASPECT_RATIO_OPTIONS.find((item) => item.value === imageAspectRatio)?.label ?? '1:1',
    [imageAspectRatio],
  )
  const imageDimensions = useMemo(
    () => calcImageDimensions(imageAspectRatio, imageResolution),
    [imageAspectRatio, imageResolution],
  )

  useEffect(() => () => {
    voicePreviewAudioRef.current?.pause()
  }, [])

  const addPastedImage = useCallback((url: string, name: string) => {
    if (!url) return
    setPastedImages((current) => {
      if (current.some((item) => item.url === url)) return current
      return [...current, { url, name }].slice(0, 6)
    })
  }, [])

  // Keep uploaded references visible across modes:
  // - Leaving first/last mode: merge first & last into pastedImages.
  // - Entering first/last mode: if empty, hydrate slots from pastedImages (so images don't "disappear").
  useEffect(() => {
    let task: number | null = null
    if (!isFirstLastFrameMode) {
      task = window.setTimeout(() => {
        if (firstFrameUrl) addPastedImage(firstFrameUrl, '首帧')
        if (lastFrameUrl) addPastedImage(lastFrameUrl, '尾帧')
      }, 0)
    } else {
      task = window.setTimeout(() => {
        if (!firstFrameUrl && pastedImages[0]?.url) {
          setFirstFrameUrl(pastedImages[0].url)
        }
        if (!lastFrameUrl && pastedImages[1]?.url) {
          setLastFrameUrl(pastedImages[1].url)
        }
      }, 0)
    }
    return () => {
      if (task != null) window.clearTimeout(task)
    }
  }, [addPastedImage, firstFrameUrl, isFirstLastFrameMode, lastFrameUrl, pastedImages])

  const visiblePastedImages = useMemo(() => {
    if (isFirstLastFrameMode) return pastedImages.slice(0, 5)
    const merged: Array<{ url: string; name: string }> = []
    const pushUnique = (item: { url: string; name: string }) => {
      if (!item.url) return
      if (merged.some((x) => x.url === item.url)) return
      merged.push(item)
    }
    if (firstFrameUrl) pushUnique({ url: firstFrameUrl, name: '首帧' })
    if (lastFrameUrl) pushUnique({ url: lastFrameUrl, name: '尾帧' })
    pastedImages.forEach(pushUnique)
    return merged.slice(0, 5)
  }, [firstFrameUrl, isFirstLastFrameMode, lastFrameUrl, pastedImages])

  const visiblePastedImageUrls = useMemo(() => visiblePastedImages.map((item) => item.url), [visiblePastedImages])
  const imageStackExpanded = (isCoarsePointer ? isImageStackManualExpanded : isImageStackHovered) && visiblePastedImages.length > 1
  const imageStackExpandedWidth = visiblePastedImages.length * 62 + 90
  const imageStackCollapsedHitWidth = visiblePastedImages.length ? 84 : 64
  const imageStackHitWidth = imageStackExpanded ? Math.max(imageStackExpandedWidth, imageStackCollapsedHitWidth) : imageStackCollapsedHitWidth
  const imageStackTextInset = 76
  const imageStackEmptyInset = 64
  const audioVoiceTextInset = 92
  const referenceLabel = visiblePastedImages.length ? `${visiblePastedImages.length}张引用` : ''
  const promptLeftPadding = toolbarMode === 'audio'
    ? audioVoiceTextInset
    : (isFirstLastFrameMode ? 172 : (visiblePastedImages.length ? imageStackTextInset : imageStackEmptyInset)) + 12
  const promptPlaceholder = useMemo(() => {
    if (toolbarMode === 'video') {
      if (videoReferenceMode === 'first_last') return '分别上传首帧和尾帧各 1 张，输入文字描述镜头运动与过渡。'
      return referenceLabel ? '上传 1-12 个参考素材，输入文字，自由组合图、文、音、视频多元素，定义你需要的镜头运动、动作与节奏。' : '上传参考素材，输入文字，自由组合图、文、音、视频多元素，定义你需要的镜头运动、动作与节奏。'
    }
    if (toolbarMode === 'audio') return '输入文字，描述你想生成的音频（风格、情绪、节奏、乐器等）。'
    return referenceLabel ? '结合参考，输入文字或 @ 主体，说说今天想做什么。' : '上传参考图、输入文字，描述你想生成的图片。'
  }, [referenceLabel, toolbarMode, videoReferenceMode])
  const mentionOptions = useMemo(() => {
    const base = visiblePastedImages.map((item, idx) => ({ id: `img-${idx}`, label: `图片${idx + 1}`, url: item.url }))
    if (!mentionQuery.trim()) return base
    const q = mentionQuery.trim().toLowerCase()
    return base.filter((item) => item.label.toLowerCase().includes(q))
  }, [mentionQuery, visiblePastedImages])
  const isPreviewVideo = useMemo(() => isVideoResourceUrl(referencePreviewUrl), [referencePreviewUrl])

  const openPreview = useCallback((url: string, title: string) => {
    setReferencePreviewUrl(url)
    setReferencePreviewTitle(title)
    setPreviewOpen(true)
  }, [])

  const updateMentionState = useCallback((value: string) => {
    const el = promptRef.current
    if (!el) return
    const cursor = el.selectionStart ?? value.length
    const beforeCursor = value.slice(0, cursor)
    const triggerMatch = beforeCursor.match(/@([^\s@]*)$/)
    if (!triggerMatch) {
      setMentionOpen(false)
      setMentionQuery('')
      setMentionFromIndex(null)
      return
    }
    const rawQuery = triggerMatch[1] ?? ''
    const atIndex = cursor - rawQuery.length - 1
    const computed = window.getComputedStyle(el)
    const mirror = document.createElement('div')
    mirror.style.position = 'absolute'
    mirror.style.visibility = 'hidden'
    mirror.style.pointerEvents = 'none'
    mirror.style.whiteSpace = 'pre-wrap'
    mirror.style.wordBreak = 'break-word'
    mirror.style.overflowWrap = 'break-word'
    mirror.style.font = computed.font
    mirror.style.letterSpacing = computed.letterSpacing
    mirror.style.lineHeight = computed.lineHeight
    mirror.style.padding = computed.padding
    mirror.style.border = computed.border
    mirror.style.width = `${el.clientWidth}px`
    mirror.textContent = beforeCursor
    const marker = document.createElement('span')
    marker.textContent = '\u200b'
    mirror.appendChild(marker)
    document.body.appendChild(mirror)
    const markerRect = marker.getBoundingClientRect()
    const mirrorRect = mirror.getBoundingClientRect()
    document.body.removeChild(mirror)
    setMentionAnchor({ left: Math.max(12, markerRect.left - mirrorRect.left + 8), top: markerRect.top - mirrorRect.top + 30 })
    setMentionFromIndex(atIndex)
    setMentionQuery(rawQuery)
    setActiveMentionIndex(0)
    setMentionOpen(true)
  }, [])

  const scheduleMentionUpdate = useCallback((value: string) => {
    if (mentionUpdateRafRef.current) cancelAnimationFrame(mentionUpdateRafRef.current)
    mentionUpdateRafRef.current = requestAnimationFrame(() => {
      mentionUpdateRafRef.current = null
      updateMentionState(value)
    })
  }, [updateMentionState])

  useEffect(() => () => {
    if (mentionUpdateRafRef.current) cancelAnimationFrame(mentionUpdateRafRef.current)
  }, [])

  useEffect(() => {
    if (!mentionOpen) return
    if (!mentionOptions.length) {
      const task = window.setTimeout(() => {
        setMentionOpen(false)
      }, 0)
      return () => {
        window.clearTimeout(task)
      }
    }
    const closeMention = () => {
      window.setTimeout(() => {
        setMentionOpen(false)
      }, 0)
    }
    const onPointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null
      if (!target) return
      if (mentionMenuRef.current?.contains(target)) return
      if (promptRef.current?.contains(target)) return
      closeMention()
    }
    document.addEventListener('mousedown', onPointerDown, true)
    document.addEventListener('touchstart', onPointerDown, true)
    return () => {
      document.removeEventListener('mousedown', onPointerDown, true)
      document.removeEventListener('touchstart', onPointerDown, true)
    }
  }, [mentionOpen, mentionOptions.length])

  const handleSelectMention = useCallback((label: string) => {
    const el = promptRef.current
    if (!el) return
    const value = el.value ?? ''
    const cursor = el.selectionStart ?? value.length
    const from = mentionFromIndex ?? value.lastIndexOf('@', Math.max(0, cursor - 1))
    if (from < 0) return
    const nextValue = `${value.slice(0, from)}${label} ${value.slice(cursor)}`
    setPrompt(nextValue)
    setMentionOpen(false)
    setMentionQuery('')
    setMentionFromIndex(null)
    pendingCursorRef.current = from + label.length + 1
  }, [mentionFromIndex, setPrompt])

  useEffect(() => {
    if (pendingCursorRef.current == null) return
    const el = promptRef.current
    if (!el) return
    const nextCursor = pendingCursorRef.current
    pendingCursorRef.current = null
    el.focus()
    el.setSelectionRange(nextCursor, nextCursor)
  }, [prompt])

  useEffect(() => {
    const media = window.matchMedia('(pointer: coarse)')
    const update = () => setIsCoarsePointer(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

  useEffect(() => {
    if (!isCoarsePointer) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setIsImageStackManualExpanded(false)
    }
  }, [isCoarsePointer])

  const renderPromptOverlay = useCallback((value: string) => {
    if (!value) return null
    const nodes: Array<{ type: 'text'; text: string } | { type: 'img'; index: number; raw: string }> = []
    const re = /@?图片(\d+)/g
    let lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = re.exec(value)) !== null) {
      const start = match.index
      if (start > lastIndex) nodes.push({ type: 'text', text: value.slice(lastIndex, start) })
      const imgIndex = Math.max(0, Number(match[1]) - 1)
      nodes.push({ type: 'img', index: imgIndex, raw: match[0] })
      lastIndex = start + match[0].length
    }
    if (lastIndex < value.length) nodes.push({ type: 'text', text: value.slice(lastIndex) })
    return nodes.map((node, idx) => {
      if (node.type === 'text') return <span key={`t-${idx}`} className="whitespace-pre-wrap">{node.text}</span>
      const url = visiblePastedImageUrls[node.index]
      const hasAtPrefix = node.raw.startsWith('@')
      if (!url) return <span key={`m-${idx}`}>{hasAtPrefix ? <span className="invisible">@</span> : null}图片{node.index + 1}</span>
      const tokenLabel = `图片${node.index + 1}`
      return (
        <span key={`m-${idx}`} className="text-[14px] font-normal leading-7 text-text-2">
          {hasAtPrefix ? <span className="invisible">@</span> : null}
          <span className="relative inline-block align-baseline">
            <span className="invisible">{tokenLabel.slice(0, 1)}</span>
            <span>{tokenLabel.slice(1)}</span>
            <span aria-hidden className="pointer-events-none absolute left-0 top-1/2 inline-flex size-[14px] -translate-y-1/2 items-center justify-center overflow-hidden rounded-[3px] bg-bg-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt="" className="h-full w-full object-cover" />
            </span>
          </span>
        </span>
      )
    })
  }, [visiblePastedImageUrls])

  async function uploadImage(file: File) {
    if (!file.type.startsWith('image/')) throw new Error('仅支持图片文件上传')
    if (file.size > MAX_IMAGE_UPLOAD_BYTES) throw new Error('图片大小不能超过 20MB')
    const formData = new FormData()
    formData.append('file', file)
    const response = await fetch('/api/v1/upload/image', { method: 'POST', body: formData })
    const text = await response.text()
    const payload = JSON.parse(text) as { code?: number; message?: string; data?: { url?: string } }
    if (!response.ok || (payload.code && payload.code >= 400) || !payload?.data?.url) throw new Error(payload?.message || '上传失败')
    return payload.data.url
  }

  function inferImageName(url: string, fallbackName: string) {
    try {
      const normalized = url.startsWith('http') ? url : `https://x.local${url.startsWith('/') ? '' : '/'}${url}`
      const u = new URL(normalized)
      const last = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() ?? '')
      if (last) return last
    } catch {}
    return fallbackName
  }

  async function handleFileUpload(event: ChangeEvent<HTMLInputElement>) {
    if (toolbarMode === 'audio') return
    const files = Array.from(event.target.files ?? [])
    if (!files.length) return
    try {
      setUploading(true)

      if (isFirstLastFrameMode) {
        const file = files[0]
        const url = await uploadImage(file)
        if (uploadTarget === 'first-frame') {
          setFirstFrameUrl(url)
          toast.success('首帧图片已上传')
          return
        }
        if (uploadTarget === 'last-frame') {
          setLastFrameUrl(url)
          toast.success('尾帧图片已上传')
          return
        }
      }

      const remainingSlots = Math.max(0, 6 - pastedImages.length)
      const selectedFiles = files.slice(0, remainingSlots)
      if (!selectedFiles.length) {
        toast.error('最多只能上传 6 张参考图')
        return
      }

      let firstUploadedUrl: string | null = null
      for (const file of selectedFiles) {
        const url = await uploadImage(file)
        if (!firstUploadedUrl) firstUploadedUrl = url
        setPastedImages((current) => {
          if (current.some((item) => item.url === url)) return current
          return [...current, { url, name: file.name || inferImageName(url, `图片${current.length + 1}`) }].slice(0, 6)
        })
      }

      setSuppressImageStackHoverExpand(true)
      setIsImageStackHovered(false)
      if (!imageUrl.trim() && firstUploadedUrl) setImageUrl(firstUploadedUrl)
      toast.success(selectedFiles.length > 1 ? `已上传 ${selectedFiles.length} 张图片` : '图片已上传')
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setUploading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  async function handlePaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    if (toolbarMode === 'audio') return
    const item = event.clipboardData.items[0]
    if (!item || !item.type.startsWith('image/')) return
    const file = item.getAsFile()
    if (!file) return
    event.preventDefault()
    try {
      setUploading(true)
      const url = await uploadImage(file)
      if (isFirstLastFrameMode) {
        if (!firstFrameUrl.trim()) {
          setFirstFrameUrl(url)
          toast.success('已粘贴并上传首帧图片')
          return
        }
        if (!lastFrameUrl.trim()) {
          setLastFrameUrl(url)
          toast.success('已粘贴并上传尾帧图片')
          return
        }
        toast.error('首帧和尾帧都已上传，如需替换请先删除对应图片')
        return
      }
      setPastedImages((current) => [...current, { url, name: file.name || inferImageName(url, `粘贴图片-${current.length + 1}`) }].slice(0, 6))
      setSuppressImageStackHoverExpand(true)
      setIsImageStackHovered(false)
      if (!imageUrl.trim()) setImageUrl(url)
      toast.success('已粘贴并上传图片')
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setUploading(false)
    }
  }

  function handleRemovePastedImage(url: string) {
    if (firstFrameUrl.trim() === url) setFirstFrameUrl('')
    if (lastFrameUrl.trim() === url) setLastFrameUrl('')
    setPastedImages((current) => {
      const next = current.filter((item) => item.url !== url)
      if (imageUrl.trim() === url) setImageUrl(next[0]?.url ?? '')
      return next
    })
  }

  async function handleVoicePreview() {
    if (!selectedVoiceId) {
      toast.warning('请先选择音色')
      return
    }
    try {
      setVoicePreviewing(true)
      voicePreviewAudioRef.current?.pause()
      const result = await audioAPI.generate({
        text: VOICE_PREVIEW_TEXT,
        voice_id: selectedVoiceId,
        speed: audioSpeed,
        emotion: audioEmotion || undefined,
        preview: true,
      })
      if (!result.audio_url) throw new Error('试听生成失败')
      const audio = new Audio(result.audio_url)
      voicePreviewAudioRef.current = audio
      audio.onended = () => setVoicePreviewing(false)
      audio.onerror = () => {
        setVoicePreviewing(false)
        toast.error('试听播放失败')
      }
      await audio.play()
    } catch (error) {
      setVoicePreviewing(false)
      toast.error((error as Error).message)
    }
  }

  async function handleSubmit() {
    const validationError = validateComposerSubmit({ prompt, toolbarMode })
    if (validationError) {
      toast.error(validationError)
      return
    }
    const submitted = await onSubmit(buildComposerSubmitPayload({
      prompt,
      pastedImageUrls: pastedImages.map((item) => item.url),
      imageUrl,
      firstFrameUrl,
      lastFrameUrl,
      referenceImagesText,
      selectedVoiceId,
      audioSpeed,
      audioEmotion,
      duration,
      aspectRatio,
      imageAspectRatio,
      toolbarMode,
      imageModel,
      videoModel,
      videoReferenceMode,
      isFirstLastFrameMode,
      audioConfigId: selectedAudioConfigId,
    }))
    if (submitted === false) {
      return
    }
    setPrompt('')
    setPastedImages([])
    setImageUrl('')
    setFirstFrameUrl('')
    setLastFrameUrl('')
    setReferenceImagesText('')
    setUploadTarget('general')
    setSuppressImageStackHoverExpand(false)
    setIsImageStackHovered(false)
    setIsImageStackManualExpanded(false)
    setPreviewOpen(false)
    setReferencePreviewUrl('')
    setReferencePreviewTitle('')
    setMentionOpen(false)
    setMentionQuery('')
    setMentionFromIndex(null)
  }

  const canSubmit = Boolean(prompt.trim()) && !submitting

  return (
    <>
      <section className="mb-6 flex flex-col items-center gap-4">
        <div className="w-full max-w-[1160px] rounded-[20px] border border-border bg-bg-0 p-3 shadow-[0_6px_18px_rgba(40,28,18,0.045),0_1px_3px_rgba(40,28,18,0.03)] sm:p-3.5">
          <div className="mb-3 min-h-[112px] rounded-[14px] bg-bg-input px-3 py-2.5 sm:min-h-[128px] sm:px-3.5 sm:py-3">
            <div className="relative flex items-start">
              <InputComposerAssetPanel
                toolbarMode={toolbarMode}
                uploading={uploading}
                isFirstLastFrameMode={isFirstLastFrameMode}
                firstFrameUrl={firstFrameUrl}
                lastFrameUrl={lastFrameUrl}
                uploadTarget={uploadTarget}
                visiblePastedImages={visiblePastedImages}
                imageStackExpanded={imageStackExpanded}
                imageStackHitWidth={imageStackHitWidth}
                imageStackExpandedWidth={imageStackExpandedWidth}
                suppressImageStackHoverExpand={suppressImageStackHoverExpand}
                isCoarsePointer={isCoarsePointer}
                voiceOptions={voiceOptions}
                voicesLoading={voicesLoading}
                selectedVoiceId={selectedVoiceId}
                voicePreviewing={voicePreviewing}
                voicePreviewText={VOICE_PREVIEW_TEXT}
                inputRef={inputRef}
                setUploadTarget={setUploadTarget}
                setSuppressImageStackHoverExpand={setSuppressImageStackHoverExpand}
                setIsImageStackHovered={setIsImageStackHovered}
                setIsImageStackManualExpanded={setIsImageStackManualExpanded}
                setSelectedVoiceId={setSelectedVoiceId}
                setFirstFrameUrl={setFirstFrameUrl}
                setLastFrameUrl={setLastFrameUrl}
                onOpenPreview={openPreview}
                onRemovePastedImage={handleRemovePastedImage}
                onPreviewVoice={() => {
                  void handleVoicePreview()
                }}
              />
              <div className="relative z-0 w-full">
                <div aria-hidden className="pointer-events-none absolute inset-0 z-0 overflow-hidden text-[14px] leading-7 text-text-2" style={{ paddingLeft: `${promptLeftPadding}px`, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                  <div ref={promptOverlayInnerRef}>{renderPromptOverlay(prompt)}</div>
                </div>
                <Textarea
                  ref={promptRef}
                  value={prompt}
                  onChange={(event) => { const next = event.target.value.replace(/@图片(\d+)/g, '图片$1'); setPrompt(next); scheduleMentionUpdate(next) }}
                  onPaste={handlePaste}
                  onScroll={(event) => { const scrollTop = (event.target as HTMLTextAreaElement).scrollTop; if (promptOverlayInnerRef.current) promptOverlayInnerRef.current.style.transform = `translateY(-${scrollTop}px)` }}
                  onBlur={() => { window.setTimeout(() => setMentionOpen(false), 0) }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                      if (mentionOpen) {
                        const item = mentionOptions[activeMentionIndex]
                        if (item) {
                          event.preventDefault()
                          handleSelectMention(item.label)
                        }
                        return
                      }

                      event.preventDefault()
                      if (canSubmit) {
                        void handleSubmit()
                      }
                      return
                    }

                    if (event.key === 'Backspace') {
                      const el = event.currentTarget
                      const start = el.selectionStart ?? 0
                      const end = el.selectionEnd ?? 0
                      if (start === end && start > 0) {
                        const before = prompt.slice(0, start)
                        const after = prompt.slice(end)
                        const tokenMatch = before.match(/@?图片\\d+\\s?$/)
                        if (tokenMatch) {
                          event.preventDefault()
                          const token = tokenMatch[0]
                          const from = start - token.length
                          const nextValue = `${prompt.slice(0, from)}${after}`
                          pendingCursorRef.current = from
                          setPrompt(nextValue)
                          setMentionOpen(false)
                          return
                        }
                      }
                    }
                    if (!mentionOpen) return
                    if (event.key === 'Escape') { event.preventDefault(); setMentionOpen(false); return }
                    if (event.key === 'ArrowDown') { event.preventDefault(); setActiveMentionIndex((current) => Math.min(current + 1, Math.max(0, mentionOptions.length - 1))); return }
                    if (event.key === 'ArrowUp') { event.preventDefault(); setActiveMentionIndex((current) => Math.max(0, current - 1)); return }
                    if (event.key === 'Enter' || event.key === 'Tab') {
                      const item = mentionOptions[activeMentionIndex]
                      if (!item) return
                      event.preventDefault()
                      handleSelectMention(item.label)
                    }
                  }}
                  placeholder={promptPlaceholder}
                  className="relative z-0 h-[92px] min-h-[92px] resize-none overflow-y-auto border-0 bg-transparent px-0 py-0 text-[14px] leading-7 text-transparent shadow-none placeholder:text-text-3 caret-text-2 focus-visible:ring-0 sm:h-[112px] sm:min-h-[112px]"
                  style={{ paddingLeft: `${promptLeftPadding}px` }}
                />
              </div>
              {mentionOpen && mentionOptions.length ? (
                <div ref={mentionMenuRef} className="absolute z-50 mt-2 w-[240px] overflow-hidden rounded-[14px] border border-border bg-popover shadow-[0_18px_42px_rgba(17,24,39,0.16)]" style={{ left: `${mentionAnchor.left}px`, top: `${mentionAnchor.top}px` }}>
                  <div className="px-3 py-2 text-[11px] font-semibold text-text-3">可能的内容</div>
                  <div className="max-h-[240px] overflow-auto py-1">
                    {mentionOptions.map((item, idx) => (
                      <button key={item.id} type="button" className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors ${idx === activeMentionIndex ? 'bg-bg-hover' : 'hover:bg-bg-hover'}`} onMouseDown={(event) => event.preventDefault()} onClick={() => handleSelectMention(item.label)}>
                        <span className="inline-flex size-7 items-center justify-center overflow-hidden rounded-[10px] border border-border bg-bg-2">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={item.url} alt={item.label} className="h-full w-full object-cover" />
                        </span>
                        <span className="text-text-1">{item.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button type="button" className={`inline-flex items-center gap-1.5 rounded-[8px] border px-2.5 py-1.5 transition-colors ${toolbarModeMeta.activeClassName}`}>
                    <toolbarModeMeta.icon size={14} />
                    {toolbarModeMeta.label}
                    <ChevronDown size={14} className="opacity-70" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-56 rounded-[14px] p-2">
                  <DropdownMenuLabel className="px-2 pb-1 pt-2 text-xs text-text-3">创作类型</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem className="rounded-[10px] px-2 py-2" onSelect={() => setToolbarMode('image')}><ImageIcon className="text-text-2" />图片生成{toolbarMode === 'image' ? <span className="ml-auto text-text-2">✓</span> : null}</DropdownMenuItem>
                  <DropdownMenuItem className="rounded-[10px] px-2 py-2" onSelect={() => setToolbarMode('video')}><Video className="text-text-2" />视频生成{toolbarMode === 'video' ? <span className="ml-auto text-text-2">✓</span> : null}</DropdownMenuItem>
                  <DropdownMenuItem className="rounded-[10px] px-2 py-2" onSelect={() => setToolbarMode('audio')}><Music2 className="text-text-2" />音频生成{toolbarMode === 'audio' ? <span className="ml-auto text-text-2">✓</span> : null}</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              {toolbarMode === 'video' ? (
                <VideoModeControls
                  videoModelOptions={videoModelOptions}
                  videoModel={videoModel}
                  videoModelsLoading={videoModelsLoading}
                  videoReferenceMode={videoReferenceMode}
                  aspectRatio={aspectRatio}
                  duration={duration}
                  onSelectVideoModel={setVideoModel}
                  onSelectVideoReferenceMode={setVideoReferenceMode}
                  onSelectAspectRatio={(value) => setAspectRatio(value)}
                  onSelectDuration={(value) => setDuration(value)}
                />
              ) : toolbarMode === 'image' ? (
                <>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button type="button" className={COMPOSER_CHIP_BTN}><Sparkles size={14} />{selectedImageModelLabel}<ChevronDown size={14} className="opacity-70" /></button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent className="min-w-[260px] rounded-[12px] p-1.5">
                      {imageModelOptions.length === 0 ? (
                        <DropdownMenuItem asChild className="rounded-[8px] px-2 py-2">
                          <Link href="/settings">前往设置 → 图片</Link>
                        </DropdownMenuItem>
                      ) : imageModelOptions.map((item) => (
                        <DropdownMenuItem key={item.value} className="rounded-[8px] px-2 py-2" onSelect={() => setImageModel(item.value)}>
                          {renderModelMenuItem(item)}
                          {item.value === imageModel ? <span className="ml-auto shrink-0 text-text-2">✓</span> : null}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button type="button" className={COMPOSER_CHIP_BTN}><Ratio size={14} />{`${selectedImageAspectLabel} 高清 ${imageResolution === '4k' ? '4K ✦' : '2K'}`}<ChevronDown size={14} className="opacity-70" /></button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent className="w-[470px] rounded-[14px] p-3">
                      <DropdownMenuLabel className="px-1 pb-2 pt-1 text-xs text-text-3">选择比例</DropdownMenuLabel>
                      <div className="grid grid-cols-9 gap-2 pb-4">
                        {IMAGE_ASPECT_RATIO_OPTIONS.map((option) => {
                          const active = imageAspectRatio === option.value
                          return (
                            <DropdownMenuItem key={option.value} className={`flex cursor-pointer flex-col items-center justify-center gap-1 rounded-[10px] border px-2 py-2 text-[11px] ${active ? 'border-accent-glow bg-accent-bg text-accent' : 'border-border bg-bg-0 text-text-1 hover:bg-bg-hover'}`} onSelect={() => setImageAspectRatio(option.value)}>
                              <span className="block h-3.5 w-3.5 rounded-[3px] border border-border-strong" />
                              <span>{option.label}</span>
                            </DropdownMenuItem>
                          )
                        })}
                      </div>
                      <div className="px-1 pb-2 text-xs text-text-3">选择分辨率</div>
                      <div className="grid grid-cols-2 gap-2 pb-4">
                        <button type="button" onClick={() => setImageResolution('2k')} className={`rounded-[10px] border px-3 py-2 text-sm ${imageResolution === '2k' ? 'border-accent-glow bg-accent-bg text-accent' : 'border-border bg-bg-0 text-text-1 hover:bg-bg-hover'}`}>高清 2K</button>
                        <button type="button" onClick={() => setImageResolution('4k')} className={`rounded-[10px] border px-3 py-2 text-sm ${imageResolution === '4k' ? 'border-accent-glow bg-accent-bg text-accent' : 'border-border bg-bg-0 text-text-1 hover:bg-bg-hover'}`}>超清 4K ✦</button>
                      </div>
                      <div className="px-1 pb-2 text-xs text-text-3">尺寸</div>
                      <div className="flex items-center gap-2">
                        <div className="flex-1 rounded-[10px] border border-border bg-bg-0 px-3 py-2 text-sm text-text-1">W {imageDimensions.width}</div>
                        <ArrowLeftRight size={14} className="text-text-3" />
                        <div className="flex-1 rounded-[10px] border border-border bg-bg-0 px-3 py-2 text-sm text-text-1">H {imageDimensions.height}</div>
                        <div className="text-xs text-text-3">PX</div>
                      </div>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </>
              ) : toolbarMode === 'audio' ? (
                <AudioModeControls
                  audioEmotion={audioEmotion}
                  audioSpeed={audioSpeed}
                  audioConfigOptions={audioConfigOptions}
                  audioConfigsLoading={audioConfigsLoading}
                  selectedAudioConfigId={selectedAudioConfigId}
                  onSelectAudioConfig={setSelectedAudioConfigId}
                  onSelectAudioEmotion={setAudioEmotion}
                  onSelectAudioSpeed={setAudioSpeed}
                />
              ) : null}
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => void handleSubmit()}
                disabled={!canSubmit}
                className={`inline-flex h-8 w-8 items-center justify-center rounded-full transition-colors ${canSubmit ? 'bg-accent text-on-accent hover:bg-accent-dark active:brightness-90' : 'bg-bg-3 text-text-3'}`}
                aria-label="提交任务"
              >
                {submitting ? <Loader2 size={14} className="animate-spin" /> : <ArrowUp size={14} />}
              </button>
            </div>
          </div>
          <input ref={inputRef} type="file" accept="image/*" multiple={!isFirstLastFrameMode} className="hidden" onChange={handleFileUpload} />
        </div>
      </section>

      <InputComposerPreviewDialog
        open={previewOpen && !!referencePreviewUrl}
        referencePreviewUrl={referencePreviewUrl}
        referencePreviewTitle={referencePreviewTitle}
        isPreviewVideo={isPreviewVideo}
        onOpenChange={(open) => {
          if (!open) setPreviewOpen(false)
        }}
      />
    </>
  )
}
