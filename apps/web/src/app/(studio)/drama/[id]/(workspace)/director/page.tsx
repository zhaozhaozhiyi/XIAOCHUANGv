import { redirect } from 'next/navigation'

export default async function DramaWorkspaceDirectorPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  redirect(`/drama/${id}`)
}
