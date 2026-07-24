import { DramaEpisodesWorkspacePage } from '@/components/drama-workspace/episodes/DramaEpisodesWorkspacePage'

export default async function DramaWorkspaceEpisodesPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return <DramaEpisodesWorkspacePage dramaId={Number(id)} />
}
