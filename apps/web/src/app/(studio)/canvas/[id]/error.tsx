'use client'

import Link from 'next/link'
import { AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'

export default function CanvasEditorError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
      <AlertTriangle size={32} className="text-error" />
      <h1 className="text-lg font-medium text-text-0">画布加载失败</h1>
      <p className="max-w-md text-sm text-text-2">{error.message}</p>
      <div className="flex gap-2">
        <Button onClick={reset}>重试</Button>
        <Button variant="outline" asChild>
          <Link href="/canvas">返回列表</Link>
        </Button>
      </div>
    </div>
  )
}
