import { DramaWorkspaceOverview } from '@/components/drama-workspace/overview/DramaWorkspaceOverview'

export default async function DramaWorkspaceOverviewPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return <DramaWorkspaceOverview dramaId={Number(id)} />
}
