import { parseEpisodeStage, type EpisodeStage } from '../episodes/episode-route'

export type DramaCanvasRouteContext = {
  episodeId?: number | null
  episodeNumber?: number | null
  stage?: EpisodeStage | null
  shot?: number | null
  origin?: string | null
}

function positiveInteger(value: string | number | null | undefined) {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

/**
 * Keep a canvas deep link tied to its originating workbench location. The
 * backend owns canvas provenance; these query fields only preserve UI return
 * semantics while a user is working in the editor.
 */
export function getDramaCanvasHref(
  dramaId: number,
  canvasId?: string,
  context: DramaCanvasRouteContext = {},
) {
  const base = canvasId
    ? `/drama/${dramaId}/canvas/${encodeURIComponent(canvasId)}`
    : `/drama/${dramaId}/canvas`
  const params = new URLSearchParams()
  const episodeId = positiveInteger(context.episodeId)
  const episodeNumber = positiveInteger(context.episodeNumber)
  const shot = positiveInteger(context.shot)

  if (episodeId) params.set('episode', String(episodeId))
  if (episodeNumber) params.set('episodeNumber', String(episodeNumber))
  if (context.stage) params.set('stage', context.stage)
  if (shot) params.set('shot', String(shot))
  if (context.origin?.trim()) params.set('origin', context.origin)

  return params.size ? `${base}?${params.toString()}` : base
}

export function getDramaCanvasContext(params: {
  get: (key: string) => string | null
}): DramaCanvasRouteContext {
  return {
    episodeId: positiveInteger(params.get('episode')),
    episodeNumber: positiveInteger(params.get('episodeNumber')),
    stage: parseEpisodeStage(params.get('stage')),
    shot: positiveInteger(params.get('shot')),
    origin: params.get('origin'),
  }
}
