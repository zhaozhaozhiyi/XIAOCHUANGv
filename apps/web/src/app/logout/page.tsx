import { LogoutClient } from './logout-client'

export default function LogoutPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-bg-page px-6">
      <div className="rounded-[28px] border border-border bg-bg-0 px-8 py-10 shadow-[0_24px_60px_rgba(40,28,18,0.08)]">
        <LogoutClient />
      </div>
    </div>
  )
}
