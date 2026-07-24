import { DramaCanvasEditorClient } from '@/components/drama-workspace/canvas/DramaCanvasEditorClient'

export default async function DramaWorkspaceCanvasEditorPage({
  params,
}: {
  params: Promise<{ id: string; canvasId: string }>
}) {
  const { id, canvasId } = await params
  return <DramaCanvasEditorClient dramaId={Number(id)} canvasId={canvasId} />
}
