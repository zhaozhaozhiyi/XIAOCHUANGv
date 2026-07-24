'use client'

import { useCallback, useEffect, useState } from 'react'
import { dramaAPI, type DramaWorkspacePayload } from '@/lib/api'

export function useDramaWorkspace(dramaId: number) {
  const [data, setData] = useState<DramaWorkspacePayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!Number.isFinite(dramaId) || dramaId <= 0) {
      setError('invalid_drama_id')
      setLoading(false)
      return null
    }

    setLoading(true)
    setError(null)
    try {
      const next = await dramaAPI.workspace(dramaId, { bypassCache: true })
      setData(next)
      return next
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
      return null
    } finally {
      setLoading(false)
    }
  }, [dramaId])

  useEffect(() => {
    let mounted = true

    async function load() {
      setLoading(true)
      setError(null)
      try {
        const next = await dramaAPI.workspace(dramaId)
        if (mounted) setData(next)
      } catch (err) {
        if (mounted) setError(err instanceof Error ? err.message : String(err))
      } finally {
        if (mounted) setLoading(false)
      }
    }

    load()

    return () => {
      mounted = false
    }
  }, [dramaId])

  return { data, loading, error, refresh }
}
