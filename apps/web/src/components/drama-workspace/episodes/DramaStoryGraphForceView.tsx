'use client'

import { memo, useEffect, useMemo } from 'react'
import {
  Background,
  Controls,
  Edge,
  MarkerType,
  Node,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  type NodeProps,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { cn } from '@/lib/cn'
import type { StoryGraphEntity, StoryGraphRelation } from '@/lib/api'
import { layoutStoryGraphNodes } from './story-graph-layout'

type StoryGraphNodeData = {
  label: string
  entityType: string
  role?: string | null
  selected?: boolean
}

function StoryGraphNode({ data, selected }: NodeProps<Node<StoryGraphNodeData>>) {
  const isScene = data.entityType === 'scene'
  const isProp = data.entityType === 'prop'
  return (
    <div
      className={cn(
        'drama-story-graph-node',
        isScene && 'is-scene',
        isProp && 'is-prop',
        (selected || data.selected) && 'is-selected',
      )}
      title={data.label}
    >
      <strong>{data.label.slice(0, 2)}</strong>
      <span>{data.label}</span>
      {data.role ? <small>{data.role}</small> : null}
    </div>
  )
}

const nodeTypes = { storyGraphEntity: StoryGraphNode }

type DramaStoryGraphForceViewProps = {
  entities: StoryGraphEntity[]
  relations: StoryGraphRelation[]
  selectedEntityId: number | null
  onSelectEntity: (entityId: number | null) => void
  onSelectRelation: (relationId: number | null) => void
}

function StoryGraphCanvas({
  entities,
  relations,
  selectedEntityId,
  onSelectEntity,
  onSelectRelation,
}: DramaStoryGraphForceViewProps) {
  const layout = useMemo(
    () => layoutStoryGraphNodes(entities, relations, 960, 520),
    [entities, relations],
  )

  const initialNodes = useMemo<Node<StoryGraphNodeData>[]>(() => {
    const positionById = new Map(layout.map((node) => [node.id, node]))
    return entities.map((entity) => {
      const position = positionById.get(String(entity.id)) || { x: 0, y: 0 }
      return {
        id: String(entity.id),
        type: 'storyGraphEntity',
        position: { x: position.x, y: position.y },
        data: {
          label: entity.display_name || entity.canonical_name,
          entityType: entity.entity_type,
          role: entity.role,
          selected: selectedEntityId === entity.id,
        },
      }
    })
  }, [entities, layout, selectedEntityId])

  const initialEdges = useMemo<Edge[]>(() => relations.map((relation) => ({
    id: String(relation.id),
    source: String(relation.subject_entity_id),
    target: String(relation.object_entity_id),
    label: relation.predicate,
    type: 'default',
    markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
    className: 'drama-story-graph-edge',
  })), [relations])

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges)

  useEffect(() => {
    setNodes(initialNodes)
    setEdges(initialEdges)
  }, [initialEdges, initialNodes, setEdges, setNodes])

  return (
    <div className="drama-story-graph-canvas">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={(_, node) => {
          onSelectRelation(null)
          onSelectEntity(Number(node.id))
        }}
        onEdgeClick={(_, edge) => {
          onSelectEntity(null)
          onSelectRelation(Number(edge.id))
        }}
        onPaneClick={() => {
          onSelectEntity(null)
          onSelectRelation(null)
        }}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.35}
        maxZoom={1.6}
        nodesDraggable
        nodesConnectable={false}
        elementsSelectable
        onlyRenderVisibleElements
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={18} size={1} color="rgba(0,0,0,0.04)" />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  )
}

export function DramaStoryGraphForceView(props: DramaStoryGraphForceViewProps) {
  return (
    <ReactFlowProvider>
      <StoryGraphCanvas {...props} />
    </ReactFlowProvider>
  )
}

export default memo(DramaStoryGraphForceView)
