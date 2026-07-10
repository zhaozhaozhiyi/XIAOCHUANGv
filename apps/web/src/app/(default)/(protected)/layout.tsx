import { AppSessionProvider } from '@/components/shared/app-session-provider'
import { requirePageAuthSession } from '@/server/backend'

export default async function ProtectedDefaultLayout({ children }: { children: React.ReactNode }) {
  const session = await requirePageAuthSession()
  return (
    <AppSessionProvider initialSession={session} initialAuthenticated>
      {children}
    </AppSessionProvider>
  )
}
