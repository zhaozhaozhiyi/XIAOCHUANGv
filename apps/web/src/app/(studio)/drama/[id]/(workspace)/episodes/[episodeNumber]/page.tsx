import '../../../episode/[episodeNumber]/episode-shell.css'
import '../../../episode/[episodeNumber]/episode-panels.css'
import { DramaEpisodeWorkbenchPage } from '@/components/drama-workspace/episodes/DramaEpisodeWorkbenchPage'

export default async function DramaWorkspaceEpisodePage({
  params,
}: {
  params: Promise<{ id: string; episodeNumber: string }>
}) {
  const { id, episodeNumber } = await params
  return <DramaEpisodeWorkbenchPage dramaId={Number(id)} episodeNumber={Number(episodeNumber)} />
}
