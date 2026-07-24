import { ProjectAssetsPanel } from '@/components/drama-workspace/sections/ProjectAssetsPanel'

export default async function DramaWorkspaceAssetsPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return <ProjectAssetsPanel dramaId={Number(id)} />
}
