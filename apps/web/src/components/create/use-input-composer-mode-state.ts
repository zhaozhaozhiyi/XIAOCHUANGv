'use client'

import { Image as ImageIcon, Music2, Video } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { aiConfigAPI, voicesAPI } from '@/lib/api'
import type { AIServiceConfig, AIVoice } from '@/types/api'
import type { AudioConfigOption, ComposerToolbarMode, ImageResolution, ModelSelectOption } from '@/components/create/input-composer-types'
import { buildAudioConfigOptions, buildModelOptions } from '@/components/create/input-composer-model-options'

interface UseInputComposerModeStateOptions {
  initialImageModelOptions?: ModelSelectOption[]
  onToolbarModeChange?: (context: {
    toolbarMode: ComposerToolbarMode
    previousToolbarMode: ComposerToolbarMode
  }) => void
}

const MODEL_OPTIONS_CACHE_TTL_MS = 60_000

const modelOptionsCache = new Map<'image' | 'video', { expiresAt: number; options: ModelSelectOption[] }>()
const inflightModelOptionRequests = new Map<'image' | 'video', Promise<ModelSelectOption[]>>()

function readCachedModelOptions(serviceType: 'image' | 'video') {
  const cached = modelOptionsCache.get(serviceType)
  if (!cached) return null
  if (cached.expiresAt <= Date.now()) {
    modelOptionsCache.delete(serviceType)
    return null
  }
  return cached.options
}

function primeModelOptionsCache(serviceType: 'image' | 'video', options: ModelSelectOption[]) {
  if (!options.length) return
  modelOptionsCache.set(serviceType, {
    options,
    expiresAt: Date.now() + MODEL_OPTIONS_CACHE_TTL_MS,
  })
}

async function loadModelOptions(serviceType: 'image' | 'video') {
  const cached = readCachedModelOptions(serviceType)
  if (cached) return cached

  const inflight = inflightModelOptionRequests.get(serviceType)
  if (inflight) return inflight

  const request = aiConfigAPI
    .list(serviceType)
    .then((configs) => buildModelOptions((configs || []) as AIServiceConfig[], serviceType))
    .then((options) => {
      if (options.length) {
        primeModelOptionsCache(serviceType, options)
      }
      return options
    })
    .finally(() => {
      inflightModelOptionRequests.delete(serviceType)
    })

  inflightModelOptionRequests.set(serviceType, request)
  return request
}

export function useInputComposerModeState(options: UseInputComposerModeStateOptions = {}) {
  const initialImageModelOptions = useMemo(
    () => options.initialImageModelOptions || [],
    [options.initialImageModelOptions],
  )
  const [toolbarMode, setToolbarMode] = useState<ComposerToolbarMode>('image')
  const [videoModel, setVideoModel] = useState<string>('')
  const [imageModel, setImageModel] = useState<string>('')
  const [imageAspectRatio, setImageAspectRatio] = useState<string>('1:1')
  const [imageResolution, setImageResolution] = useState<ImageResolution>('2k')
  const [videoModelOptions, setVideoModelOptions] = useState<ModelSelectOption[]>([])
  const [imageModelOptions, setImageModelOptions] = useState<ModelSelectOption[]>(initialImageModelOptions)
  const [voiceOptions, setVoiceOptions] = useState<AIVoice[]>([])
  const [audioConfigOptions, setAudioConfigOptions] = useState<AudioConfigOption[]>([])
  const [imageModelsLoading, setImageModelsLoading] = useState(false)
  const [videoModelsLoading, setVideoModelsLoading] = useState(false)
  const [voicesLoading, setVoicesLoading] = useState(false)
  const [audioConfigsLoading, setAudioConfigsLoading] = useState(false)
  const [selectedVoiceId, setSelectedVoiceId] = useState('')
  const [selectedAudioConfigId, setSelectedAudioConfigId] = useState<number | null>(null)
  const [audioSpeed, setAudioSpeed] = useState(1)
  const [audioEmotion, setAudioEmotion] = useState('')
  const [videoReferenceMode, setVideoReferenceMode] = useState<string>('multiple')
  const [duration, setDuration] = useState<number | string>(5)
  const [aspectRatio, setAspectRatio] = useState<string | number>('16:9')

  const imageModelsLoadedRef = useRef(initialImageModelOptions.length > 0)
  const imageModelsLoadingRef = useRef(false)
  const videoModelsLoadedRef = useRef(false)
  const videoModelsLoadingRef = useRef(false)
  const voicesLoadingRef = useRef(false)
  const voicesProviderRef = useRef<string | null>(null)
  const audioConfigsLoadedRef = useRef(false)
  const audioConfigsLoadingRef = useRef(false)
  const previousToolbarModeRef = useRef<ComposerToolbarMode>(toolbarMode)
  const onToolbarModeChangeRef = useRef(options.onToolbarModeChange)

  useEffect(() => {
    onToolbarModeChangeRef.current = options.onToolbarModeChange
  }, [options.onToolbarModeChange])

  useEffect(() => {
    if (!initialImageModelOptions.length) return
    primeModelOptionsCache('image', initialImageModelOptions)
  }, [initialImageModelOptions])

  const toolbarModeMeta = useMemo(() => {
    if (toolbarMode === 'video') {
      return { label: '视频生成', icon: Video, activeClassName: 'border-border bg-accent2-bg text-accent2-text' }
    }
    if (toolbarMode === 'audio') {
      return { label: '音频生成', icon: Music2, activeClassName: 'border-border bg-accent2-bg text-accent-dark' }
    }
    return { label: '图片生成', icon: ImageIcon, activeClassName: 'border-accent-glow bg-accent-bg text-accent' }
  }, [toolbarMode])

  const isFirstLastFrameMode = toolbarMode === 'video' && videoReferenceMode === 'first_last'

  const loadImageModels = useCallback(async () => {
    if (imageModelsLoadedRef.current || imageModelsLoadingRef.current) return
    imageModelsLoadingRef.current = true
    setImageModelsLoading(true)
    try {
      const nextOptions = await loadModelOptions('image')
      setImageModelOptions(nextOptions)
      imageModelsLoadedRef.current = true
    } catch {
      setImageModelOptions([])
    } finally {
      imageModelsLoadingRef.current = false
      setImageModelsLoading(false)
    }
  }, [])

  const loadVideoModels = useCallback(async () => {
    if (videoModelsLoadedRef.current || videoModelsLoadingRef.current) return
    videoModelsLoadingRef.current = true
    setVideoModelsLoading(true)
    try {
      const nextOptions = await loadModelOptions('video')
      setVideoModelOptions(nextOptions)
      videoModelsLoadedRef.current = true
    } catch {
      setVideoModelOptions([])
    } finally {
      videoModelsLoadingRef.current = false
      setVideoModelsLoading(false)
    }
  }, [])

  const loadVoices = useCallback(async (provider: string) => {
    // 按服务商加载音色；切换服务商时重新拉取，避免沿用上一个服务商的音色。
    if (voicesProviderRef.current === provider) return
    voicesProviderRef.current = provider
    voicesLoadingRef.current = true
    setVoicesLoading(true)
    try {
      const voices = await voicesAPI.list(provider || undefined) as unknown as AIVoice[]
      setVoiceOptions(voices || [])
    } catch {
      setVoiceOptions([])
      voicesProviderRef.current = null
    } finally {
      voicesLoadingRef.current = false
      setVoicesLoading(false)
    }
  }, [])

  const loadAudioConfigs = useCallback(async () => {
    if (audioConfigsLoadedRef.current || audioConfigsLoadingRef.current) return
    audioConfigsLoadingRef.current = true
    setAudioConfigsLoading(true)
    try {
      const configs = await aiConfigAPI.list('audio') as unknown as AIServiceConfig[]
      setAudioConfigOptions(buildAudioConfigOptions(configs || []))
      audioConfigsLoadedRef.current = true
    } catch {
      setAudioConfigOptions([])
    } finally {
      audioConfigsLoadingRef.current = false
      setAudioConfigsLoading(false)
    }
  }, [])

  const selectedAudioConfig = useMemo(
    () => audioConfigOptions.find((item) => item.id === selectedAudioConfigId) ?? null,
    [audioConfigOptions, selectedAudioConfigId],
  )

  useEffect(() => {
    const task = window.setTimeout(() => {
      void loadImageModels()
    }, 0)
    return () => {
      window.clearTimeout(task)
    }
  }, [loadImageModels])

  useEffect(() => {
    if (videoModelOptions.some((item) => item.value === videoModel)) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setVideoModel(videoModelOptions[0]?.value || '')
  }, [videoModel, videoModelOptions])

  useEffect(() => {
    if (imageModelOptions.some((item) => item.value === imageModel)) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setImageModel(imageModelOptions[0]?.value || '')
  }, [imageModel, imageModelOptions])

  useEffect(() => {
    let task: number | null = null
    if (toolbarMode === 'video') {
      task = window.setTimeout(() => {
        void loadVideoModels()
      }, 0)
      return
    }
    if (toolbarMode === 'audio') {
      task = window.setTimeout(() => {
        void loadAudioConfigs()
      }, 0)
    }
    return () => {
      if (task != null) window.clearTimeout(task)
    }
  }, [loadVideoModels, loadAudioConfigs, toolbarMode])

  useEffect(() => {
    if (selectedAudioConfigId != null && audioConfigOptions.some((item) => item.id === selectedAudioConfigId)) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelectedAudioConfigId(audioConfigOptions[0]?.id ?? null)
  }, [selectedAudioConfigId, audioConfigOptions])

  useEffect(() => {
    if (toolbarMode !== 'audio') return
    const task = window.setTimeout(() => {
      void loadVoices(selectedAudioConfig?.provider ?? '')
    }, 0)
    return () => {
      window.clearTimeout(task)
    }
  }, [toolbarMode, selectedAudioConfig?.provider, loadVoices])

  useEffect(() => {
    if (voiceOptions.some((item) => item.voice_id === selectedVoiceId)) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelectedVoiceId(voiceOptions[0]?.voice_id || '')
  }, [selectedVoiceId, voiceOptions])

  useEffect(() => {
    const previousToolbarMode = previousToolbarModeRef.current
    if (previousToolbarMode === toolbarMode) return
    previousToolbarModeRef.current = toolbarMode
    onToolbarModeChangeRef.current?.({ toolbarMode, previousToolbarMode })
  }, [toolbarMode])

  return {
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
  }
}
