import { DefaultSettingsPanel } from '@/components/drama-workspace/sections/DefaultSettingsPanel'

export default async function DramaWorkspaceSettingsPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return <DefaultSettingsPanel dramaId={Number(id)} />
}
