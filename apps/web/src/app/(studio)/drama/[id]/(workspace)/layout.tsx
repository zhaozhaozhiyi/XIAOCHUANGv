import { AppSessionProvider } from '@/components/shared/app-session-provider'
import { DramaWorkspaceShell } from '@/components/drama-workspace/DramaWorkspaceShell'
import { hasSessionCookie } from '@/server/backend'
import '@/components/drama-workspace/drama-workspace.css'

export default async function DramaWorkspaceLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const dramaId = Number(id)
  const initialAuthenticated = await hasSessionCookie()

  return (
    <AppSessionProvider initialSession={null} initialAuthenticated={initialAuthenticated}>
      <DramaWorkspaceShell dramaId={dramaId}>
        {children}
      </DramaWorkspaceShell>
    </AppSessionProvider>
  )
}
