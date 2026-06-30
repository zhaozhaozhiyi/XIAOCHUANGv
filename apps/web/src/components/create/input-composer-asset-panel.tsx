'use client'

import dynamic from 'next/dynamic'
import type { Dispatch, RefObject, SetStateAction } from 'react'
import { ArrowLeftRight, Loader2, X } from 'lucide-react'

import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { AIVoice } from '@/types/api'

const AudioVoiceDock = dynamic(
  () => import('./input-composer-audio-voice-dock').then((mod) => ({ default: mod.AudioVoiceDock })),
  { ssr: false, loading: () => null },
)

const UPLOAD_SLOT_BTN =
  'inline-flex flex-col items-center justify-center gap-1 rounded-[3px] border border-border bg-bg-2 text-text-3 transition-transform duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] will-change-transform hover:scale-[1.04] active:scale-[0.97]'

const IMAGE_CARD_BORDER =
  'border border-border bg-bg-0 shadow-[0_6px_14px_rgba(17,24,39,0.12)]'

type ToolbarMode = 'image' | 'video' | 'audio'
type UploadTarget = 'general' | 'first-frame' | 'last-frame'
type VisibleAsset = { url: string; name: string }

function isVideoResourceUrl(url: string) {
  const normalized = url.split('#')[0]?.split('?')[0]?.toLowerCase() ?? ''
  return normalized.endsWith('.mp4') || normalized.endsWith('.webm') || normalized.endsWith('.mov') || normalized.endsWith('.m4v')
}

export function InputComposerAssetPanel(props: {
  toolbarMode: ToolbarMode
  uploading: boolean
  isFirstLastFrameMode: boolean
  firstFrameUrl: string
  lastFrameUrl: string
  uploadTarget: UploadTarget
  visiblePastedImages: VisibleAsset[]
  imageStackExpanded: boolean
  imageStackHitWidth: number
  imageStackExpandedWidth: number
  suppressImageStackHoverExpand: boolean
  isCoarsePointer: boolean
  voiceOptions: AIVoice[]
  voicesLoading: boolean
  selectedVoiceId: string
  voicePreviewing: boolean
  voicePreviewText: string
  inputRef: RefObject<HTMLInputElement | null>
  setUploadTarget: Dispatch<SetStateAction<UploadTarget>>
  setSuppressImageStackHoverExpand: Dispatch<SetStateAction<boolean>>
  setIsImageStackHovered: Dispatch<SetStateAction<boolean>>
  setIsImageStackManualExpanded: Dispatch<SetStateAction<boolean>>
  setSelectedVoiceId: Dispatch<SetStateAction<string>>
  setFirstFrameUrl: Dispatch<SetStateAction<string>>
  setLastFrameUrl: Dispatch<SetStateAction<string>>
  onOpenPreview: (url: string, title: string) => void
  onRemovePastedImage: (url: string) => void
  onPreviewVoice: () => void
}) {
  const triggerUpload = (target: UploadTarget) => {
    props.setUploadTarget(target)
    props.inputRef.current?.click()
  }

  if (props.toolbarMode === 'audio') {
    return (
      <div className="absolute left-0 top-0 z-30 mt-0.5 h-[86px] w-[76px]">
        <AudioVoiceDock
          voiceOptions={props.voiceOptions}
          voicesLoading={props.voicesLoading}
          selectedVoiceId={props.selectedVoiceId}
          voicePreviewing={props.voicePreviewing}
          voicePreviewText={props.voicePreviewText}
          onSelectVoice={props.setSelectedVoiceId}
          onPreview={() => {
            props.onPreviewVoice()
          }}
        />
      </div>
    )
  }

  return (
    <div
      className="absolute left-0 top-0 z-30 mt-0.5 h-[74px]"
      style={{ width: `${props.isFirstLastFrameMode ? 172 : props.imageStackHitWidth}px` }}
      onClick={() => {
        if (props.isCoarsePointer && props.visiblePastedImages.length > 1) {
          props.setIsImageStackManualExpanded((current) => !current)
        }
      }}
    >
      {props.isFirstLastFrameMode ? (
        <div className="flex h-full items-center gap-2">
          <div className="relative h-[68px] w-[54px]">
            {props.firstFrameUrl ? (
              <button
                type="button"
                className={`group/image relative h-full w-full rotate-[-6deg] transform-gpu overflow-hidden rounded-[3px] ${IMAGE_CARD_BORDER} transition-transform duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] will-change-transform hover:scale-[1.04] active:scale-[0.97]`}
                onClick={() => props.onOpenPreview(props.firstFrameUrl, '首帧')}
                aria-label="预览首帧"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={props.firstFrameUrl} alt="首帧" className="h-full w-full object-cover" />
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation()
                    props.setFirstFrameUrl('')
                  }}
                  className="absolute right-1 top-1 inline-flex size-4 items-center justify-center rounded-full bg-black/55 text-white opacity-0 transition-opacity duration-200 group-hover/image:opacity-100"
                  aria-label="删除首帧"
                >
                  <X size={11} />
                </button>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => triggerUpload('first-frame')}
                className={`h-full w-full rotate-[-6deg] transform-gpu ${UPLOAD_SLOT_BTN}`}
                disabled={props.uploading}
                aria-label="上传首帧"
              >
                {props.uploading && props.uploadTarget === 'first-frame' ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <>
                    <span className="text-lg leading-none">+</span>
                    <span className="text-[11px] font-medium leading-none text-text-3">首帧</span>
                  </>
                )}
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={() => {
              const nextFirst = props.lastFrameUrl
              const nextLast = props.firstFrameUrl
              props.setFirstFrameUrl(nextFirst)
              props.setLastFrameUrl(nextLast)
            }}
            className="inline-flex size-6 items-center justify-center text-text-3 transition-colors hover:text-text-2 active:text-text-1"
            aria-label="交换首帧与尾帧"
            title="交换"
            disabled={props.uploading || (!props.firstFrameUrl && !props.lastFrameUrl)}
          >
            <ArrowLeftRight size={16} />
          </button>
          <div className="relative h-[68px] w-[54px]">
            {props.lastFrameUrl ? (
              <button
                type="button"
                className={`group/image relative h-full w-full rotate-[6deg] transform-gpu overflow-hidden rounded-[3px] ${IMAGE_CARD_BORDER} transition-transform duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] will-change-transform hover:scale-[1.04] active:scale-[0.97]`}
                onClick={() => props.onOpenPreview(props.lastFrameUrl, '尾帧')}
                aria-label="预览尾帧"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={props.lastFrameUrl} alt="尾帧" className="h-full w-full object-cover" />
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation()
                    props.setLastFrameUrl('')
                  }}
                  className="absolute right-1 top-1 inline-flex size-4 items-center justify-center rounded-full bg-black/55 text-white opacity-0 transition-opacity duration-200 group-hover/image:opacity-100"
                  aria-label="删除尾帧"
                >
                  <X size={11} />
                </button>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => triggerUpload('last-frame')}
                className={`h-full w-full rotate-[6deg] transform-gpu ${UPLOAD_SLOT_BTN}`}
                disabled={props.uploading}
                aria-label="上传尾帧"
              >
                {props.uploading && props.uploadTarget === 'last-frame' ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <>
                    <span className="text-lg leading-none">+</span>
                    <span className="text-[11px] font-medium leading-none text-text-3">尾帧</span>
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      ) : props.visiblePastedImages.length ? (
        <div
          className="relative h-full w-full"
          onMouseMove={(event) => {
            if (props.suppressImageStackHoverExpand) return
            const target = event.target as HTMLElement | null
            const hoveringImageCard = Boolean(target?.closest('[data-image-card="true"]'))
            const hoveringUploadTrigger = Boolean(target?.closest('[data-upload-trigger="true"]'))
            const rect = event.currentTarget.getBoundingClientRect()
            const pointerX = event.clientX - rect.left
            const pointerY = event.clientY - rect.top
            const hoveringStackKeepOpenZone =
              pointerX >= 0 &&
              pointerX <= Math.max(0, props.imageStackExpandedWidth - 16) &&
              pointerY >= -10 &&
              pointerY <= 84
            props.setIsImageStackHovered((current) => {
              if (hoveringImageCard) return true
              if (current && hoveringUploadTrigger) return true
              if (current && hoveringStackKeepOpenZone && !hoveringUploadTrigger) return true
              return false
            })
          }}
          onMouseLeave={() => {
            props.setIsImageStackHovered(false)
            if (props.suppressImageStackHoverExpand) props.setSuppressImageStackHoverExpand(false)
          }}
        >
          <div
            aria-hidden
            className="absolute left-0 top-0 h-full"
            style={{ width: props.imageStackExpanded ? `${props.imageStackExpandedWidth}px` : '100%' }}
          />
          {(() => {
            const expandGap = 62
            const chronologicalImages = [...props.visiblePastedImages]
            const centerIndex = (chronologicalImages.length - 1) / 2
            const collapsedBase = { x: 4, y: 3 }
            const oddBaseRotation = -6
            const evenBaseRotation = 6
            const parityStepRotation = 10

            return (
              <>
                {chronologicalImages.map((item, index) => {
                  const url = item.url
                  const previewLabel = `${isVideoResourceUrl(url) ? '视频' : '图片'}${index + 1}`
                  const sequenceIndex = index + 1
                  const oddOrder = Math.floor((sequenceIndex + 1) / 2)
                  const evenOrder = Math.floor(sequenceIndex / 2)
                  const collapsedRotate =
                    sequenceIndex % 2 === 1
                      ? oddBaseRotation - (oddOrder - 1) * parityStepRotation
                      : evenBaseRotation + (evenOrder - 1) * parityStepRotation
                  const distanceFromCenter = Math.abs(index - centerIndex)
                  const expandedX = index * expandGap + (index % 2 === 0 ? 0 : 3)
                  const expandedY =
                    -Math.max(0, 9 - distanceFromCenter * 2.4) +
                    (index % 3 === 0 ? -1.5 : index % 3 === 1 ? 1 : 0)
                  const expandedRotate =
                    sequenceIndex % 2 === 1 ? -(1.6 + oddOrder * 0.7) : 1.6 + evenOrder * 0.7
                  const offsetX = props.imageStackExpanded ? expandedX : collapsedBase.x
                  const liftY = props.imageStackExpanded ? expandedY : collapsedBase.y
                  const rotate = props.imageStackExpanded ? expandedRotate : collapsedRotate

                  return (
                    <Tooltip key={url}>
                      <TooltipTrigger asChild>
                        <div
                          data-image-card="true"
                          tabIndex={0}
                          role="button"
                          aria-label={`预览${previewLabel}`}
                          onClick={() => props.onOpenPreview(url, previewLabel)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault()
                              props.onOpenPreview(url, previewLabel)
                            }
                          }}
                          className="group/image absolute left-0 top-0 h-[70px] w-[57px] overflow-visible transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] will-change-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus focus-visible:ring-offset-2 focus-visible:ring-offset-bg-0"
                          style={{
                            zIndex: index + 10,
                            transform: `translateX(${offsetX}px) translateY(${liftY}px) rotate(${rotate}deg)`,
                            transitionDelay: props.imageStackExpanded
                              ? `${index * 22}ms`
                              : `${(chronologicalImages.length - index - 1) * 14}ms`,
                          }}
                        >
                          <div
                            className={`relative h-full w-full rounded-none ${IMAGE_CARD_BORDER} transition-transform duration-200 ease-out group-hover/image:scale-[1.18] group-hover/image:-translate-y-1`}
                          >
                            <div className="h-full w-full overflow-hidden">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={url} alt="参考图" className="h-full w-full object-cover" />
                            </div>
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation()
                                props.onRemovePastedImage(url)
                              }}
                              className="absolute right-1 top-1 inline-flex size-4 items-center justify-center rounded-full bg-black/55 text-white opacity-0 transition-opacity duration-200 group-hover/image:opacity-100"
                              aria-label="删除参考图"
                            >
                              <X size={11} />
                            </button>
                          </div>
                        </div>
                      </TooltipTrigger>
                      <TooltipContent side="top" sideOffset={8}>
                        {previewLabel}
                      </TooltipContent>
                    </Tooltip>
                  )
                })}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      data-upload-trigger="true"
                      onClick={() => triggerUpload('general')}
                      className={`absolute z-20 inline-flex items-center justify-center border border-border bg-bg-2 text-text-3 transition-colors hover:scale-[1.06] hover:bg-bg-0 active:scale-[0.96] ${props.imageStackExpanded ? 'top-0 h-[70px] w-[57px] rounded-none rotate-[-2deg]' : (props.visiblePastedImages.length === 1 ? 'top-[45px] h-7 w-7 rounded-full' : 'top-[49px] h-7 w-7 rounded-full')}`}
                      style={{
                        left: `${props.visiblePastedImages.length === 1 ? 36 : (props.imageStackExpanded ? chronologicalImages.length * expandGap + 6 : Math.min(collapsedBase.x + 32, 186))}px`,
                      }}
                      disabled={props.uploading}
                      aria-label="继续上传图片"
                    >
                      {props.uploading ? <Loader2 size={14} className="animate-spin" /> : <span className="text-lg leading-none">+</span>}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top" sideOffset={8}>
                    上传参数内容
                  </TooltipContent>
                </Tooltip>
              </>
            )
          })()}
        </div>
      ) : (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => triggerUpload('general')}
              className={`h-[70px] w-[57px] rotate-[-7deg] transform-gpu ${UPLOAD_SLOT_BTN} hover:scale-[1.07]`}
              disabled={props.uploading}
              aria-label="上传参考素材"
            >
              {props.uploading ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <>
                  <span className="text-lg leading-none">+</span>
                  {props.toolbarMode === 'video' ? (
                    <span className="text-[11px] font-medium leading-none text-text-3">参考内容</span>
                  ) : null}
                </>
              )}
            </button>
          </TooltipTrigger>
          <TooltipContent side="top" sideOffset={8}>
            上传参数内容
          </TooltipContent>
        </Tooltip>
      )}
    </div>
  )
}
