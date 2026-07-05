import { backendFetch, buildBackendProxyInit, copySetCookieHeader, wrapBackendJson } from '@/server/backend'

export const runtime = 'nodejs'

type Params = { path?: string[] }

function isReadableStream(value: unknown): value is ReadableStream<Uint8Array> {
  return typeof value === 'object' && value !== null && 'getReader' in value
}

function buildBackendPath(request: Request, path: string[]) {
  const url = new URL(request.url)
  return path.length === 0
    ? `/api/v1${url.search}`
    : `/api/v1/${path.join('/')}${url.search}`
}

function wantsEventStream(request: Request, response: Response) {
  const url = new URL(request.url)
  return url.searchParams.get('stream') === '1'
    || response.headers.get('content-type')?.includes('text/event-stream')
}

function buildStreamResponse(response: Response) {
  return new Response(response.body, {
    status: response.status,
    headers: {
      'Content-Type': response.headers.get('content-type') || 'text/event-stream; charset=utf-8',
      'Cache-Control': response.headers.get('cache-control') || 'no-cache, no-transform',
      Connection: response.headers.get('connection') || 'keep-alive',
      'X-Accel-Buffering': response.headers.get('x-accel-buffering') || 'no',
    },
  })
}

function isJsonLikeResponse(response: Response) {
  const contentType = response.headers.get('content-type') || ''
  if (!contentType) return true
  return contentType.includes('application/json') || contentType.includes('+json')
}

function buildPassthroughResponse(response: Response) {
  const headers = new Headers()
  for (const name of [
    'content-type',
    'content-disposition',
    'cache-control',
    'etag',
    'last-modified',
    'content-length',
  ]) {
    const value = response.headers.get(name)
    if (value) headers.set(name, value)
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

function buildJsonError(status: number, message: string, details?: unknown) {
  return Response.json(
    {
      code: status,
      message,
      details,
    },
    { status },
  )
}

async function buildNonJsonErrorResponse(response: Response, backendPath: string) {
  const text = await response.text().catch(() => '')
  const preview = text.trim().slice(0, 300)
  const status = response.status || 502
  const message = preview
    ? `后端接口返回了非 JSON 错误（HTTP ${status}）：${preview}`
    : `后端接口返回了空错误响应（HTTP ${status}）`

  return buildJsonError(status, message, {
    path: backendPath,
    status,
    statusText: response.statusText,
    preview,
  })
}

function buildProxyFailureResponse(error: unknown, backendPath: string) {
  const message = error instanceof Error ? error.message : String(error)
  return buildJsonError(502, '后端服务暂时不可用，请确认 backend 服务已启动后重试', {
    path: backendPath,
    error: message,
  })
}

async function proxyV1Request(request: Request, path: string[]) {
  const backendPath = buildBackendPath(request, path)
  let backendResponse: Response

  try {
    backendResponse = await backendFetch(
      backendPath,
      await buildBackendProxyInit(request),
    )
  } catch (error) {
    return buildProxyFailureResponse(error, backendPath)
  }

  if (backendResponse.ok && wantsEventStream(request, backendResponse) && isReadableStream(backendResponse.body)) {
    return buildStreamResponse(backendResponse)
  }

  if (!isJsonLikeResponse(backendResponse)) {
    if (!backendResponse.ok) {
      const errorResponse = await buildNonJsonErrorResponse(backendResponse, backendPath)
      return copySetCookieHeader(backendResponse, errorResponse)
    }
    return copySetCookieHeader(backendResponse, buildPassthroughResponse(backendResponse))
  }

  const wrappedResponse = await wrapBackendJson(backendResponse)
  return copySetCookieHeader(backendResponse, wrappedResponse)
}

export async function GET(request: Request, context: { params: Promise<Params> }) {
  const { path = [] } = await context.params
  return proxyV1Request(request, path)
}

export async function POST(request: Request, context: { params: Promise<Params> }) {
  const { path = [] } = await context.params
  return proxyV1Request(request, path)
}

export async function PUT(request: Request, context: { params: Promise<Params> }) {
  const { path = [] } = await context.params
  return proxyV1Request(request, path)
}

export async function PATCH(request: Request, context: { params: Promise<Params> }) {
  const { path = [] } = await context.params
  return proxyV1Request(request, path)
}

export async function DELETE(request: Request, context: { params: Promise<Params> }) {
  const { path = [] } = await context.params
  return proxyV1Request(request, path)
}
