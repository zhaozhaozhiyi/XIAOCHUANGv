/**
 * 编辑器全屏布局 — 复用 (studio) 路由组，无 sidebar / header。
 * 鉴权由父级 (studio)/layout.tsx 的 requirePageSession 已经处理。
 *
 * 主题跟随全局 next-themes（<html class="dark">），画布样式见 canvas-theme.css。
 */
export default function CanvasEditorLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-canvas-bg text-canvas-text">
      {children}
    </div>
  )
}
