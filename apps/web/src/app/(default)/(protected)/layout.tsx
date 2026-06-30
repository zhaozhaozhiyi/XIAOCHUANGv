import { requirePageSession } from '@/server/backend'

export default async function ProtectedDefaultLayout({ children }: { children: React.ReactNode }) {
  await requirePageSession()
  return children
}
