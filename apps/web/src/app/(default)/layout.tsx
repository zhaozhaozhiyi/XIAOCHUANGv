import { Header } from '@/components/layout/header'
import { AppSidebar } from '@/components/layout/app-sidebar'
import { AppSessionProvider } from '@/components/shared/app-session-provider'
import { hasSessionCookie } from '@/server/backend'

export default async function DefaultLayout({ children }: { children: React.ReactNode }) {
  const initialAuthenticated = await hasSessionCookie()

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-bg-surface">
      <Header />
      <div className="flex min-h-0 flex-1 overflow-hidden bg-bg-surface">
        <AppSidebar />
        <main className="min-h-0 flex-1 overflow-auto bg-bg-surface p-3 sm:p-4 lg:p-5">
          <div className="shell-main-card min-h-full">
            <AppSessionProvider initialSession={null} initialAuthenticated={initialAuthenticated}>
              {children}
            </AppSessionProvider>
          </div>
        </main>
      </div>
    </div>
  )
}
