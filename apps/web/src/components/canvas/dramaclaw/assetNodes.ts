'use client'

import type { XYPosition } from '@xyflow/react'

import { staticUrl } from '@/lib/utils'
import type { FlowNode } from '@/lib/canvas/store'
import { cryptoRandomId } from '../editor/_utils'
import {
  DRAMACLAW_NODE_DEFINITION_MAP,
  DRAMACLAW_NODE_TYPES,
  dramaClawDefaultData,
  type DramaClawNodeType,
} from './registry'

export interface DramaClawAssetLike {
  id?: string | number
  asset_id?: string | number
  kind?: string | null
  role?: string | null
  title?: string | null
  label?: string | null
  url?: string | null
  thumbnail_url?: string | null
  provider?: string | null
  status?: string | null
}

export function createDramaClawNode(
  type: DramaClawNodeType,
  position: XYPosition,
  data: Record<string, unknown> = {},
): FlowNode {
  const definition = DRAMACLAW_NODE_DEFINITION_MAP[type]
  return {
    id: `node_${cryptoRandomId()}`,
    type,
    position,
    width: definition.defaultSize.width,
    data: {
      ...dramaClawDefaultData(type),
      ...data,
    },
  } as FlowNode
}

export function createDramaClawNodeFromAsset(asset: DramaClawAssetLike, position: XYPosition): FlowNode {
  const kind = String(asset.kind || '').toLowerCase()
  const title = asset.title || asset.label || '未命名素材'
  const sourceUrl = staticUrl(asset.url || '')
  const thumbnailUrl = staticUrl(asset.thumbnail_url || '')
  const common = {
    displayName: title,
    title,
    label: title,
    assetId: String(asset.asset_id ?? asset.id ?? ''),
    role: asset.role || '',
    provider: asset.provider || '',
    status: asset.status || '',
  }

  if (kind === 'video') {
    return createDramaClawNode(DRAMACLAW_NODE_TYPES.video, position, {
      ...common,
      videoUrl: sourceUrl,
      previewImageUrl: thumbnailUrl,
      referenceOnly: true,
    })
  }

  if (kind === 'audio') {
    return createDramaClawNode(DRAMACLAW_NODE_TYPES.audio, position, {
      ...common,
      audioUrl: sourceUrl,
      url: sourceUrl,
      referenceOnly: true,
    })
  }

  return createDramaClawNode(DRAMACLAW_NODE_TYPES.imageEdit, position, {
    ...common,
    imageUrl: sourceUrl,
    previewImageUrl: thumbnailUrl || sourceUrl,
    referenceOnly: true,
  })
}

export const DRAMACLAW_ASSET_DRAG_MIME = 'application/x-xiaochuang-dramaclaw-asset'

export function serializeDramaClawAssetDrag(asset: DramaClawAssetLike) {
  return JSON.stringify(asset)
}

export function parseDramaClawAssetDrag(raw: string): DramaClawAssetLike | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed as DramaClawAssetLike : null
  } catch {
    return null
  }
}
