'use client'

import { useEffect } from 'react'
import { RotateCcw } from 'lucide-react'

const THEME_INIT_SCRIPT = `
(function() {
  try {
    var theme = localStorage.getItem('theme');
    var dark = theme === 'dark' || (theme !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    if (dark) document.documentElement.classList.add('dark');
  } catch (e) {}
})();
`

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        <style>{`
          :root {
            --color-bg-page: #ffffff;
            --color-text-0: #333333;
            --color-text-2: #666666;
            --color-text-3: #666666;
            --color-accent: #b05b43;
            --color-on-accent: #ffffff;
            --color-primary-foreground: #ffffff;
          }
          .dark {
            --color-bg-page: #1a1512;
            --color-text-0: #f0e8e0;
            --color-text-2: #a89b90;
            --color-text-3: #6e6158;
            --color-accent: #b05b43;
            --color-on-accent: #ffffff;
            --color-primary-foreground: #fffaf7;
          }
          body {
            margin: 0;
            background: var(--color-bg-page);
            color: var(--color-text-0);
          }
          .ge-muted { color: var(--color-text-2); }
          .ge-accent-text { color: rgba(212, 131, 102, 0.18); }
          .dark .ge-accent-text { color: rgba(212, 131, 102, 0.25); }
        `}</style>
      </head>
      <body style={{ fontFamily: 'PingFang SC, -apple-system, sans-serif' }}>
        <div style={{
          display: 'flex',
          minHeight: '100vh',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px',
          textAlign: 'center',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 32 }}>
            <div style={{
              width: 36, height: 36, borderRadius: 12,
              background: 'var(--color-accent)', display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'var(--color-primary-foreground)',
            }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M7 4v16M17 4v16M3 8h4m10 0h4M3 12h18M3 16h4m10 0h4M4 20h16a1 1 0 0 0 1-1V5a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1z"/>
              </svg>
            </div>
            <span style={{ fontWeight: 600, fontSize: 15, letterSpacing: '-0.02em' }}>
              小窗 XIAOCHUANG
            </span>
          </div>

          <p className="ge-accent-text" style={{ fontSize: 96, fontWeight: 700, lineHeight: 1, margin: 0, userSelect: 'none' }}>
            500
          </p>
          <h1 style={{ marginTop: 16, fontSize: 24, fontWeight: 600 }}>发生了严重错误</h1>
          <p className="ge-muted" style={{ marginTop: 8, fontSize: 14, maxWidth: 300, lineHeight: 1.7 }}>
            应用遇到了无法恢复的错误，请尝试刷新页面。
          </p>

          <button
            onClick={reset}
            style={{
              marginTop: 32, display: 'inline-flex', alignItems: 'center', gap: 8,
              borderRadius: 999, background: 'var(--color-accent)', color: 'var(--color-on-accent)',
              padding: '10px 20px', fontSize: 14, fontWeight: 500, border: 'none', cursor: 'pointer',
            }}
          >
            <RotateCcw size={14} />
            刷新重试
          </button>
        </div>
      </body>
    </html>
  )
}
