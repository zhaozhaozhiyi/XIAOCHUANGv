import { Suspense } from 'react'

import { HomePageClient, HomePageFallback } from '@/app/(default)/home-page-client'
import { CREATE_HEADER_VARIANTS } from '@/app/(default)/home-page-copy'
import { buildModelOptions } from '@/components/create/input-composer-model-options'
import type { ModelSelectOption } from '@/components/create/input-composer-types'
import { backendFetch } from '@/server/backend'
import type { AIServiceConfig, Drama } from '@/types/api'

type DramaListPayload = {
  items?: Drama[]
}

type BackendEnvelope<T> = {
  code?: number
  message?: string
  data?: T
}

function extractDramaItems(payload: DramaListPayload | BackendEnvelope<DramaListPayload> | null | undefined) {
  if (payload && 'items' in payload && Array.isArray(payload.items)) {
    return payload.items
  }
  if (payload && 'data' in payload && Array.isArray(payload.data?.items)) {
    return payload.data.items
  }
  return []
}

function extractAiConfigs(payload: AIServiceConfig[] | BackendEnvelope<AIServiceConfig[]> | null | undefined) {
  if (Array.isArray(payload)) {
    return payload
  }
  if (payload && 'data' in payload && Array.isArray(payload.data)) {
    return payload.data
  }
  return []
}

async function getInitialDramas(): Promise<Drama[]> {
  try {
    const response = await backendFetch('/api/v1/dramas?include_details=0')
    if (!response.ok) {
      return []
    }

    const payload = (await response.json()) as DramaListPayload | BackendEnvelope<DramaListPayload>
    return extractDramaItems(payload)
  } catch {
    return []
  }
}

async function getInitialImageModelOptions(): Promise<ModelSelectOption[]> {
  try {
    const response = await backendFetch('/api/v1/ai-configs?service_type=image')
    if (!response.ok) {
      return []
    }

    const payload = (await response.json()) as AIServiceConfig[] | BackendEnvelope<AIServiceConfig[]>
    return buildModelOptions(extractAiConfigs(payload), 'image')
  } catch {
    return []
  }
}

function getCreateHeader() {
  if (!CREATE_HEADER_VARIANTS.length) {
    return { title: '', description: '' }
  }

  if (CREATE_HEADER_VARIANTS.length === 1) {
    return CREATE_HEADER_VARIANTS[0]
  }

  const randomIndex = 1 + Math.floor(Math.random() * (CREATE_HEADER_VARIANTS.length - 1))
  return CREATE_HEADER_VARIANTS[randomIndex] ?? CREATE_HEADER_VARIANTS[0]
}

export default async function HomePage() {
  const [initialDramas, initialImageModelOptions] = await Promise.all([
    getInitialDramas(),
    getInitialImageModelOptions(),
  ])
  const createHeader = getCreateHeader()

  return (
    <Suspense fallback={<HomePageFallback />}>
      <HomePageClient
        initialDramas={initialDramas}
        createHeader={createHeader}
        initialImageModelOptions={initialImageModelOptions}
      />
    </Suspense>
  )
}
