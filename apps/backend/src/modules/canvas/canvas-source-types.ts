export const CANVAS_ASSET_SOURCE_TYPES = {
  UPLOAD: 'canvas_upload',
  GENERATION: 'canvas_generation',
  EXPORT: 'canvas_export',
  HISTORY: 'canvas_history',
} as const

export type CanvasAssetSourceType =
  (typeof CANVAS_ASSET_SOURCE_TYPES)[keyof typeof CANVAS_ASSET_SOURCE_TYPES]

export const CANVAS_ASSET_SOURCE_TYPE_VALUES = Object.values(CANVAS_ASSET_SOURCE_TYPES)

export function isCanvasAssetSourceType(value: unknown): value is CanvasAssetSourceType {
  return typeof value === 'string' && CANVAS_ASSET_SOURCE_TYPE_VALUES.includes(value as CanvasAssetSourceType)
}

export function normalizeCanvasAssetSourceType(
  value: unknown,
  fallback: CanvasAssetSourceType = CANVAS_ASSET_SOURCE_TYPES.GENERATION,
): CanvasAssetSourceType {
  return isCanvasAssetSourceType(value) ? value : fallback
}
