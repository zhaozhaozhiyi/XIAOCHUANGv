import { redirect } from 'next/navigation'
import {
  getLegacyEpisodeNumber,
  getLegacyEpisodeWorkbenchHref,
  type RouteSearchParams,
} from '@/components/drama-workspace/episodes/episode-route'

export default async function DramaWorkspaceStoryboardsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<RouteSearchParams>
}) {
  const [{ id }, rawSearchParams] = await Promise.all([params, searchParams])
  const episodeNumber = getLegacyEpisodeNumber(rawSearchParams)
  if (episodeNumber) {
    redirect(
      getLegacyEpisodeWorkbenchHref({
        dramaId: id,
        episodeNumber,
        searchParams: rawSearchParams,
        fallbackStage: 'storyboard',
      }),
    )
  }
  redirect(`/drama/${id}/episodes?stage=storyboard`)
}
