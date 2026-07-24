import { redirect } from 'next/navigation'
import {
  getLegacyEpisodeNumber,
  getLegacyEpisodeWorkbenchHref,
  type EpisodeStage,
  type RouteSearchParams,
} from '@/components/drama-workspace/episodes/episode-route'

export default async function DramaWorkspaceShotsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<RouteSearchParams>
}) {
  const [{ id }, rawSearchParams] = await Promise.all([params, searchParams])
  const episodeNumber = getLegacyEpisodeNumber(rawSearchParams)
  const requestedStage = rawSearchParams.stage
  const stage: EpisodeStage =
    (Array.isArray(requestedStage) ? requestedStage[0] : requestedStage) === 'video'
      ? 'video'
      : 'assets'
  if (episodeNumber) {
    redirect(
      getLegacyEpisodeWorkbenchHref({
        dramaId: id,
        episodeNumber,
        searchParams: rawSearchParams,
        fallbackStage: stage,
      }),
    )
  }
  redirect(`/drama/${id}/episodes`)
}
