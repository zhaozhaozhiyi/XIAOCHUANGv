import { create } from 'zustand'

import type { CanvasChatEvent, CanvasChatPlan } from '@/lib/canvas/types'

export type CanvasChatMessage = {
  id: string
  role: 'user' | 'assistant'
  text: string
  event?: CanvasChatEvent
}

interface CanvasChatState {
  messages: CanvasChatMessage[]
  pendingPlan: CanvasChatPlan | null
  addMessage: (message: CanvasChatMessage) => void
  setPendingPlan: (plan: CanvasChatPlan | null) => void
  clear: () => void
}

export const useCanvasChatStore = create<CanvasChatState>((set) => ({
  messages: [],
  pendingPlan: null,
  addMessage: (message) => set((state) => ({ messages: [...state.messages, message] })),
  setPendingPlan: (plan) => set({ pendingPlan: plan }),
  clear: () => set({ messages: [], pendingPlan: null }),
}))
