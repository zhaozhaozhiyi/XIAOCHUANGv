import type { AuthSession } from '@/types/auth'

export interface RawAuthSessionUser {
  id: number
  adminUserId?: string | null
  admin_user_id?: string | null
  accountType?: string | null
  account_type?: string | null
  role?: string | null
  displayName?: string | null
  display_name?: string | null
  email?: string | null
  phone?: string | null
  status?: string | null
}

export interface RawAuthSessionPayload {
  authenticated?: boolean
  session?: {
    id: number
    userId?: number
    user_id?: number
    user?: RawAuthSessionUser | null
  } | null
}

export function normalizeAuthSession(payload: RawAuthSessionPayload | null | undefined): AuthSession | null {
  const session = payload?.session
  const user = session?.user

  if (!payload?.authenticated || !session || !user) {
    return null
  }

  return {
    id: session.id,
    user_id: session.userId ?? session.user_id ?? user.id,
    user: {
      id: user.id,
      admin_user_id: user.admin_user_id ?? user.adminUserId ?? null,
      account_type: user.account_type ?? user.accountType ?? 'user',
      role: user.role ?? 'user',
      display_name: user.display_name ?? user.displayName ?? '',
      email: user.email ?? null,
      phone: user.phone ?? null,
      status: user.status ?? 'active',
    },
  }
}
