#!/usr/bin/env node
import http from 'node:http'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const adminRoot = path.resolve(__dirname, '../../admin')
const host = '127.0.0.1'
const adminPort = Number(process.env.E2E_ADMIN_PORT || 5175)
const backendPort = Number(process.env.E2E_ADMIN_BACKEND_PORT || 5999)
const backendBaseUrl = `http://${host}:${backendPort}`
const npxCommand = process.platform === 'win32' ? 'npx.cmd' : 'npx'

let adminProcess = null
let shuttingDown = false

function sendJson(response, status, payload) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  response.end(JSON.stringify(payload))
}

function paginationFrom(url) {
  return {
    page: Number(url.searchParams.get('page') || 1),
    pageSize: Number(url.searchParams.get('pageSize') || 20),
    total: 0,
  }
}

const server = http.createServer((request, response) => {
  const url = new URL(request.url || '/', backendBaseUrl)

  if (request.method === 'GET' && url.pathname === '/api/v1/auth/session') {
    sendJson(response, 200, { authenticated: false })
    return
  }

  if (request.method === 'GET' && url.pathname === '/api/v1/admin/overview') {
    sendJson(response, 200, {
      stats: {
        userCount: 0,
        dramaCount: 0,
        activeSubscriptionCount: 0,
      },
      recentUsers: [],
    })
    return
  }

  if (request.method === 'GET' && url.pathname === '/api/v1/admin/users') {
    sendJson(response, 200, {
      items: [],
      pagination: paginationFrom(url),
    })
    return
  }

  if (request.method === 'GET' && url.pathname === '/api/v1/admin/dramas') {
    sendJson(response, 200, {
      items: [],
      pagination: paginationFrom(url),
    })
    return
  }

  if (request.method === 'GET' && url.pathname === '/api/v1/admin/subscriptions') {
    sendJson(response, 200, {
      items: [],
      plans: [],
      pagination: paginationFrom(url),
    })
    return
  }

  sendJson(response, 404, { error: 'not_found' })
})

function shutdown(exitCode = 0) {
  if (shuttingDown) return
  shuttingDown = true

  if (adminProcess && !adminProcess.killed) {
    adminProcess.kill('SIGTERM')
  }

  server.close(() => {
    process.exit(exitCode)
  })
}

server.listen(backendPort, host, () => {
  adminProcess = spawn(
    npxCommand,
    ['next', 'dev', '--port', String(adminPort), '-H', host],
    {
      cwd: adminRoot,
      env: {
        ...process.env,
        BACKEND_BASE_URL: backendBaseUrl,
      },
      stdio: 'inherit',
    },
  )

  adminProcess.on('exit', (code, signal) => {
    if (shuttingDown) return
    if (signal) {
      shutdown(1)
      return
    }
    shutdown(code ?? 0)
  })
})

process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))
