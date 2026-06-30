'use client'

import { createContext, useCallback, useContext, useMemo, useState } from 'react'

import { normalizeAuthSession, type RawAuthSessionPayload } from '@/lib/auth-session'
import type { AuthSession, CurrentUser } from '@/types/auth'

interface SessionApiEnvelope {
  data?: RawAuthSessionPayload
}

interface AppSessionContextValue {
  session: AuthSession | null
  authenticated: boolean
  currentUser: CurrentUser | null
  refreshing: boolean
  refreshSession: () => Promise<AuthSession | null>
}

const AppSessionContext = createContext<AppSessionContextValue | null>(null)

export function AppSessionProvider({
  initialSession,
  initialAuthenticated = false,
  children,
}: {
  initialSession: AuthSession | null
  initialAuthenticated?: boolean
  children: React.ReactNode
}) {
  const [session, setSession] = useState<AuthSession | null>(initialSession)
  const [authenticated, setAuthenticated] = useState(Boolean(initialSession) || initialAuthenticated)
  const [refreshing, setRefreshing] = useState(false)

  const refreshSession = useCallback(async () => {
    try {
      setRefreshing(true)
      const response = await fetch('/api/v1/auth/session', { cache: 'no-store' })
      const payload = (await response.json().catch(() => ({}))) as SessionApiEnvelope
      const nextSession = normalizeAuthSession(payload.data)
      setSession(nextSession)
      setAuthenticated(Boolean(nextSession))
      return nextSession
    } catch {
      setSession(null)
      setAuthenticated(false)
      return null
    } finally {
      setRefreshing(false)
    }
  }, [])

  const value = useMemo<AppSessionContextValue>(() => ({
    session,
    authenticated,
    currentUser: session?.user ?? null,
    refreshing,
    refreshSession,
  }), [authenticated, refreshSession, refreshing, session])

  return (
    <AppSessionContext.Provider value={value}>
      {children}
    </AppSessionContext.Provider>
  )
}

export function useAppSession() {
  const context = useContext(AppSessionContext)

  if (!context) {
    throw new Error('useAppSession must be used within AppSessionProvider')
  }

  return context
}
