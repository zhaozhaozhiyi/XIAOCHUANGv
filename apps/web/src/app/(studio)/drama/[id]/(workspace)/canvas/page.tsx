import { DramaCanvasWorkspacePage } from '@/components/drama-workspace/canvas/DramaCanvasWorkspacePage'

export default async function DramaWorkspaceCanvasPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return <DramaCanvasWorkspacePage dramaId={Number(id)} />
}
