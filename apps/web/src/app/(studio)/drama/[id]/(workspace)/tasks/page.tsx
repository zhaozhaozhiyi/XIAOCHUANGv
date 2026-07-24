import { redirect } from 'next/navigation'

export default async function DramaWorkspaceTasksPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { id } = await params
  const query = await searchParams
  const next = new URLSearchParams({ panel: 'tasks' })
  const first = (key: string) => {
    const value = query[key]
    return Array.isArray(value) ? value[0] : value
  }
  const status = first('status')
  const task = first('task')
  if (status) next.set('taskStatus', status)
  if (task) next.set('task', task)
  redirect(`/drama/${id}?${next.toString()}`)
}
