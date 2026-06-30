import { createReadStream } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'

type StaticParams = {
  '*': string
}

function getMimeType(filePath: string) {
  const ext = path.extname(filePath).toLowerCase()
  switch (ext) {
    case '.png':
      return 'image/png'
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg'
    case '.gif':
      return 'image/gif'
    case '.webp':
      return 'image/webp'
    case '.svg':
      return 'image/svg+xml'
    case '.mp4':
      return 'video/mp4'
    case '.webm':
      return 'video/webm'
    case '.mp3':
      return 'audio/mpeg'
    case '.wav':
      return 'audio/wav'
    case '.ogg':
      return 'audio/ogg'
    case '.json':
      return 'application/json'
    default:
      return 'application/octet-stream'
  }
}

function resolveSafeTarget(root: string, relativePath: string) {
  const normalizedRoot = path.resolve(root)
  const targetPath = path.resolve(normalizedRoot, relativePath)
  const relative = path.relative(normalizedRoot, targetPath)
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    return null
  }
  return targetPath
}

async function sendStaticFile(
  request: FastifyRequest<{ Params: StaticParams }>,
  reply: FastifyReply,
  root: string,
) {
  const relativePath = decodeURIComponent(String(request.params['*'] || ''))
  const targetPath = resolveSafeTarget(root, relativePath)
  if (!targetPath) {
    return reply.code(404).send('Not found')
  }

  try {
    const stat = await fs.stat(targetPath)
    if (!stat.isFile()) {
      return reply.code(404).send('Not found')
    }

    const mimeType = getMimeType(targetPath)
    reply.header('Content-Type', mimeType)
    reply.header('Cache-Control', 'public, max-age=3600')
    reply.header('Accept-Ranges', 'bytes')

    const rangeHeader = request.headers.range
    if (rangeHeader) {
      const match = rangeHeader.match(/bytes=(\d*)-(\d*)/)
      if (!match) {
        reply.header('Content-Range', `bytes */${stat.size}`)
        return reply.code(416).send('Range Not Satisfiable')
      }

      const hasStart = match[1] !== ''
      const hasEnd = match[2] !== ''
      let start = 0
      let end = stat.size - 1

      if (hasStart) {
        start = Number(match[1])
        end = hasEnd ? Number(match[2]) : stat.size - 1
      } else if (hasEnd) {
        const suffixLength = Number(match[2])
        start = Math.max(stat.size - suffixLength, 0)
      }

      start = Math.max(0, start)
      end = Math.min(end, stat.size - 1)

      if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= stat.size) {
        reply.header('Content-Range', `bytes */${stat.size}`)
        return reply.code(416).send('Range Not Satisfiable')
      }

      const chunkSize = end - start + 1
      reply.code(206)
      reply.header('Content-Range', `bytes ${start}-${end}/${stat.size}`)
      reply.header('Content-Length', String(chunkSize))
      if (request.method === 'HEAD') {
        return reply.send()
      }
      return reply.send(createReadStream(targetPath, { start, end }))
    }

    reply.header('Content-Length', String(stat.size))
    if (request.method === 'HEAD') {
      return reply.send()
    }
    return reply.send(createReadStream(targetPath))
  } catch {
    return reply.code(404).send('Not found')
  }
}

export function registerStorageStaticRoutes(fastify: FastifyInstance, localRoot: string) {
  fastify.route<{ Params: StaticParams }>({
    method: ['GET', 'HEAD'],
    url: '/static/*',
    handler: (request, reply) => sendStaticFile(request, reply, localRoot),
  })
}
