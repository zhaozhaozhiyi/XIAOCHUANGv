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

async function proxyV1Request(request: Request, path: string[]) {
  const backendResponse = await backendFetch(
    buildBackendPath(request, path),
    await buildBackendProxyInit(request),
  )

  if (backendResponse.ok && wantsEventStream(request, backendResponse) && isReadableStream(backendResponse.body)) {
    return buildStreamResponse(backendResponse)
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
