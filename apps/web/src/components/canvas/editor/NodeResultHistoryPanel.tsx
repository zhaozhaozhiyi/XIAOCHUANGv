'use client'

import { useEffect, useState } from 'react'
import { Download, FolderHeart } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Dialog, DialogActions, DialogContent, DialogHeaderBar, DialogMain, DialogTitle } from '@/components/ui/dialog'
import { canvasApi } from '@/lib/canvas/api/canvas'
import { useCanvasStore, useNodesStore } from '@/lib/canvas/store'
import type { CanvasNodeResult } from '@/lib/canvas/types'

export function NodeResultHistoryPanel({
  open,
  onOpenChange,
  nodeId,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  nodeId: string | null
}) {
  const canvasId = useCanvasStore((s) => s.canvasId)
  const updateNodeData = useNodesStore((s) => s.updateNodeData)
  const [results, setResults] = useState<CanvasNodeResult[]>([])
  const [currentId, setCurrentId] = useState<string | null>(null)

  useEffect(() => {
    if (!open || !canvasId || !nodeId) return
    void canvasApi.listNodeResults(canvasId, nodeId).then((data) => {
      setResults(data.results)
      setCurrentId(data.current_result_id)
    })
  }, [canvasId, nodeId, open])

  const selectResult = async (result: CanvasNodeResult) => {
    if (!canvasId || !nodeId) return
    const data = await canvasApi.selectNodeResult(canvasId, nodeId, result.id)
    updateNodeData(nodeId, data.node.data)
    setCurrentId(result.id)
  }

  const saveAsset = async (result: CanvasNodeResult) => {
    if (!canvasId || !nodeId) return
    const data = await canvasApi.saveNodeResultToAsset(canvasId, { node_id: nodeId, result_id: result.id })
    updateNodeData(nodeId, data.node.data)
    const nextResults = Array.isArray(data.node.data.results)
      ? (data.node.data.results as CanvasNodeResult[])
      : results.map((item) => item.id === result.id ? data.result : item)
    setResults(nextResults)
    setCurrentId(typeof data.node.data.current_result_id === 'string' ? data.node.data.current_result_id : currentId)
    toast.success('已保存到资产库')
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent variant="workspace" size="large">
        <DialogHeaderBar variant="workspace">
          <DialogTitle className="text-base">生成历史</DialogTitle>
        </DialogHeaderBar>
        <DialogMain variant="workspace" className="max-h-[60vh]">
          {results.length === 0 ? (
            <div className="rounded-lg border border-border bg-bg-1 px-4 py-8 text-center text-sm text-text-2">暂无生成历史</div>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {results.map((result) => (
                <div
                  key={result.id}
                  data-testid={`node-result-card-${result.id}`}
                  className="overflow-hidden rounded-lg border border-border bg-bg-1"
                >
                  <button
                    type="button"
                    data-testid={`node-result-select-${result.id}`}
                    className="block aspect-video w-full bg-bg-2"
                    onClick={() => void selectResult(result)}
                  >
                    {result.kind === 'image' ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={result.thumbnail_url || result.url} alt="" className="size-full object-cover" />
                    ) : (
                      <div className="flex size-full items-center justify-center text-xs text-text-2">{result.kind}</div>
                    )}
                  </button>
                  <div className="flex items-center justify-between gap-1 p-2">
                    <span className="truncate text-xs text-text-2">{result.asset_id ? '已入资产' : currentId === result.id ? '当前结果' : result.title || result.kind}</span>
                    <div className="flex gap-1">
                      <Button type="button" size="icon-xs" variant="ghost" aria-label="下载历史结果" onClick={() => window.open(result.url, '_blank')}>
                        <Download className="size-3" />
                      </Button>
                      <Button
                        type="button"
                        size="icon-xs"
                        variant="ghost"
                        data-testid={`node-result-save-asset-${result.id}`}
                        aria-label={result.asset_id ? '历史结果已入资产' : '保存历史结果到资产'}
                        onClick={() => void saveAsset(result)}
                        disabled={Boolean(result.asset_id)}
                      >
                        <FolderHeart className="size-3" />
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </DialogMain>
        <DialogActions variant="workspace">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>关闭</Button>
        </DialogActions>
      </DialogContent>
    </Dialog>
  )
}
