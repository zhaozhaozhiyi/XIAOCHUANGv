/**
 * Canvas Perf 页布局（v0.2.0 PR2 dev only）
 *
 * 仅 development 可见；production 会重定向回 /canvas。
 * 主题跟随全局 next-themes，见 canvas-theme.css。
 */

import { redirect } from 'next/navigation'

export default function CanvasPerfLayout({ children }: { children: React.ReactNode }) {
  if (process.env.NODE_ENV === 'production') {
    redirect('/canvas')
  }
  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-canvas-bg text-canvas-text">
      {children}
    </div>
  )
}
