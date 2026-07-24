import { DramaFinalPage } from '@/components/drama-workspace/final/DramaFinalPage'

export default async function DramaWorkspaceFinalPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return <DramaFinalPage dramaId={Number(id)} />
}
