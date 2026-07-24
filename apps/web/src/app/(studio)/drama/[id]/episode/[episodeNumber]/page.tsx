import { redirect } from 'next/navigation'
import {
  getLegacyEpisodeWorkbenchHref,
  type RouteSearchParams,
} from '@/components/drama-workspace/episodes/episode-route'

export default async function LegacyDramaEpisodePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; episodeNumber: string }>
  searchParams: Promise<RouteSearchParams>
}) {
  const [{ id, episodeNumber }, rawSearchParams] = await Promise.all([params, searchParams])
  redirect(
    getLegacyEpisodeWorkbenchHref({
      dramaId: id,
      episodeNumber,
      searchParams: rawSearchParams,
    }),
  )
}
