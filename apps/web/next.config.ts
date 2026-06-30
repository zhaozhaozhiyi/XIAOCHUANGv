import path from 'node:path'
import type { NextConfig } from 'next'

/**
 * 开发态与生产态必须使用不同 distDir，避免 manifest / CSS chunk 互相污染：
 * `next dev` 需要虚拟化的 app/layout.css，而 `next build/start` 会产出带哈希的静态 CSS。
 * 两种模式共用同一目录时，最容易出现「HTML 正常但样式 404」。
 *
 * outputFileTracingRoot 仅用于生产构建的 serverless 文件追踪（monorepo 根在上两级）。
 * 在 `next dev` 下也开启时，少数环境下可能影响静态资源解析；开发态不设置更稳。
 */
const nextDistDir =
  process.env.NEXT_DIST_DIR?.trim() ||
  (process.env.NODE_ENV === 'production' ? '.next-prod' : '.next-dev')

function trimTrailingSlashes(value: string) {
  return value.replace(/\/+$/, '')
}

function normalizeOrigin(value: string) {
  const url = new URL(value)
  if (url.hostname === '0.0.0.0') {
    url.hostname = '127.0.0.1'
  }
  return trimTrailingSlashes(url.origin)
}

function resolvePublicBackendBaseUrl() {
  const explicit = String(process.env.NEXT_PUBLIC_BACKEND_BASE_URL || '').trim()
  if (explicit) {
    return normalizeOrigin(explicit)
  }

  const backendBaseUrl = String(process.env.BACKEND_BASE_URL || 'http://127.0.0.1:3010').trim()
  if (!backendBaseUrl) return ''

  try {
    const url = new URL(backendBaseUrl)
    if (['127.0.0.1', 'localhost', '0.0.0.0'].includes(url.hostname)) {
      return normalizeOrigin(backendBaseUrl)
    }
  } catch {
    return ''
  }

  return ''
}

const publicBackendBaseUrl = resolvePublicBackendBaseUrl()
const explicitPublicMediaBaseUrl = String(process.env.NEXT_PUBLIC_MEDIA_BASE_URL || '').trim()
const publicMediaBaseUrl = explicitPublicMediaBaseUrl
  ? trimTrailingSlashes(explicitPublicMediaBaseUrl)
  : publicBackendBaseUrl
    ? `${publicBackendBaseUrl}/static`
    : ''

if (process.env.NODE_ENV === 'production' && !publicMediaBaseUrl) {
  throw new Error(
    'NEXT_PUBLIC_MEDIA_BASE_URL or NEXT_PUBLIC_BACKEND_BASE_URL is required for apps/web production builds.',
  )
}

const nextConfig: NextConfig = {
  distDir: nextDistDir,
  env: {
    NEXT_PUBLIC_BACKEND_BASE_URL: publicBackendBaseUrl,
    NEXT_PUBLIC_MEDIA_BASE_URL: publicMediaBaseUrl,
  },
  ...(process.env.NODE_ENV === 'production'
    ? { outputFileTracingRoot: path.resolve(process.cwd(), '../..') }
    : {}),
  experimental: {
    // App Router multipart/form-data uploads can hit Next's default 10MB limit
    // before our route handler runs. Keep the framework limit above the
    // business-level upload cap so the API can return a controlled error.
    middlewareClientMaxBodySize: '25mb',
  },
  modularizeImports: {
    // 按需导入 lucide-react 图标，减少 tree-shaking 压力
    'lucide-react': {
      transform: 'lucide-react/dist/esm/icons/{{name}}',
      skipDefaultConversion: true,
    },
  },
  /**
   * webpack: NodeNext ESM 兼容
   *
   * `packages/canvas-shared` 是 NodeNext ESM 包，其源码内部 import 强制带 `.js`
   * 后缀（如 `./schema/index.js`）。`apps/web/tsconfig.json` 的 paths 把
   * `@xiaochuang/canvas-shared` 指向 `src/index.ts`，让 Next 直接编译 TS 源码
   * 以拿到 hot reload —— 此时 webpack 的 bundler resolver 解不到 `.js` 文件。
   *
   * extensionAlias 让 `.js` 的 import 回退尝试 `.ts/.tsx`，是 Next + ESM
   * monorepo 的官方推荐解法。
   */
  webpack(config) {
    config.resolve = config.resolve ?? {}
    config.resolve.extensionAlias = {
      ...(config.resolve.extensionAlias ?? {}),
      '.js': ['.js', '.ts', '.tsx'],
      '.mjs': ['.mjs', '.mts'],
    }
    return config
  },
}

export default nextConfig
