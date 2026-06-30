/**
 * Maps browser `fetch` network failures to actionable copy (Chinese).
 * When the request never completes, `response.json()` is never reached — users only see "Failed to fetch".
 */
export function friendlyFetchErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback
  const m = error.message.trim().toLowerCase()
  if (
    m.includes('failed to fetch')
    || m.includes('load failed')
    || m.includes('networkerror when attempting to fetch')
  ) {
    return '无法连接到当前应用（请求未到达服务器）。请确认已在 apps/web 目录运行 npm run dev、地址栏端口与终端一致，并刷新后重试。'
  }
  return error.message || fallback
}
