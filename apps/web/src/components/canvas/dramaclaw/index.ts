'use client'

import type { NodeTypes } from '@xyflow/react'

import { DramaClawNode } from './DramaClawNode'
import { DRAMACLAW_NODE_DEFINITIONS } from './registry'

export const dramaClawNodeTypes: NodeTypes = Object.fromEntries(
  DRAMACLAW_NODE_DEFINITIONS.map((definition) => [definition.type, DramaClawNode]),
) as NodeTypes

export * from './assetNodes'
export * from './registry'
