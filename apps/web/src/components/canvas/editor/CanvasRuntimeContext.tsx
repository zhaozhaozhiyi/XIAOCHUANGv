'use client'

import { createContext, useContext, type ReactNode } from 'react'
import type { CanvasNodeResult } from '@/lib/canvas/types'

export type CanvasRuntimeProfile = 'default' | 'drama'
export type CanvasRuntimeChrome = 'default' | 'freezone'

export type CanvasRuntimeContextData = {
  dramaId?: number
  episodeId?: number
  storyboardId?: number
  commitTarget?: 'asset_pool' | 'storyboard' | 'episode'
}

export type CanvasRuntimeSlots = {
  topbarExtra?: ReactNode
  nodeActionsExtra?: (args: {
    nodeId: string
    nodeType: string
    nodeData: Record<string, unknown>
    currentResult?: CanvasNodeResult | null
    close: () => void
  }) => ReactNode
}

export type CanvasRuntimeValue = {
  profile?: CanvasRuntimeProfile
  chrome?: CanvasRuntimeChrome
  context?: CanvasRuntimeContextData
  backHref?: string
  backLabel?: string
  slots?: CanvasRuntimeSlots
}

const defaultRuntime: Required<Pick<CanvasRuntimeValue, 'profile' | 'chrome' | 'backHref' | 'backLabel'>> & CanvasRuntimeValue = {
  profile: 'default',
  chrome: 'default',
  backHref: '/canvas',
  backLabel: '返回画布列表',
  context: {},
  slots: {},
}

const CanvasRuntimeContext = createContext<CanvasRuntimeValue>(defaultRuntime)

export function CanvasRuntimeProvider({
  value,
  children,
}: {
  value?: CanvasRuntimeValue
  children: ReactNode
}) {
  return (
    <CanvasRuntimeContext.Provider
      value={{
        ...defaultRuntime,
        ...value,
        context: {
          ...defaultRuntime.context,
          ...value?.context,
        },
        slots: {
          ...defaultRuntime.slots,
          ...value?.slots,
        },
      }}
    >
      {children}
    </CanvasRuntimeContext.Provider>
  )
}

export function useCanvasRuntime() {
  return useContext(CanvasRuntimeContext)
}
