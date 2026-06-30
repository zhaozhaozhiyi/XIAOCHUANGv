import { createParser } from 'eventsource-parser'

type SSEEvent = { event?: string; data: string }

export async function fetchSSE(params: {
  url: string
  method?: 'GET' | 'POST'
  headers?: Record<string, string>
  body?: unknown
  signal?: AbortSignal
  onEvent: (evt: SSEEvent) => void
}) {
  const resp = await fetch(params.url, {
    method: params.method ?? 'GET',
    headers: {
      ...(params.headers || {}),
      ...(params.body ? { 'Content-Type': 'application/json' } : {}),
      Accept: 'text/event-stream',
    },
    body: params.body == null ? undefined : JSON.stringify(params.body),
    signal: params.signal,
  })

  if (!resp.ok) {
    const text = await resp.text().catch(() => '')
    throw new Error(text || `${resp.status}`)
  }

  if (!resp.body) throw new Error('SSE response body is empty')

  const decoder = new TextDecoder()
  const reader = resp.body.getReader()

  let handlerError: unknown = null
  const parser = createParser({
    onEvent: (evt) => {
    try {
      params.onEvent({ event: evt.event || undefined, data: evt.data })
    } catch (e) {
      handlerError = e
    }
    },
  })

  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    parser.feed(decoder.decode(value, { stream: true }))
    if (handlerError) throw handlerError
  }
}

