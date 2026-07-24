'use client'

import { useEffect, useState } from 'react'
import { Loader2, Search } from 'lucide-react'
import { dramaAPI, type StoryGraphSearchHit } from '@/lib/api'
import { getAiErrorCopy } from '@/lib/ai-error-copy'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/cn'

const KIND_LABELS: Record<string, string> = {
  entity: '实体',
  relation: '关系',
  event: '事件',
  script_span: '剧本片段',
  writing_card: '写作知识卡',
}

type DramaStoryGraphSearchPanelProps = {
  dramaId: number
  disabled?: boolean
  onSelectEntity: (entityId: number) => void
  onSelectRelation: (relationId: number) => void
}

export function DramaStoryGraphSearchPanel({
  dramaId,
  disabled,
  onSelectEntity,
  onSelectRelation,
}: DramaStoryGraphSearchPanelProps) {
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [items, setItems] = useState<StoryGraphSearchHit[]>([])
  const [mode, setMode] = useState<string | null>(null)
  const trimmedQuery = query.trim()
  const visibleItems = trimmedQuery ? items : []
  const visibleError = trimmedQuery ? error : null
  const visibleMode = trimmedQuery ? mode : null
  const visibleLoading = trimmedQuery ? loading : false

  useEffect(() => {
    if (!trimmedQuery) return undefined
    let cancelled = false

    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          setLoading(true)
          setError(null)
          const payload = await dramaAPI.searchStoryGraph(dramaId, {
            query: trimmedQuery,
            limit: 12,
          })
          if (cancelled) return
          setItems(payload.items)
          setMode(payload.mode)
        } catch (err) {
          if (cancelled) return
          setError(getAiErrorCopy(err))
          setItems([])
        } finally {
          if (!cancelled) setLoading(false)
        }
      })()
    }, 320)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [dramaId, trimmedQuery])

  function handleSelect(item: StoryGraphSearchHit) {
    if (item.entity_id) {
      onSelectEntity(item.entity_id)
      return
    }
    if (item.relation_id) {
      onSelectRelation(item.relation_id)
    }
  }

  return (
    <section className="drama-story-graph-search">
      <div className="drama-story-graph-search-bar">
        <Search size={16} />
        <input
          type="search"
          value={query}
          disabled={disabled}
          placeholder="语义搜索角色、关系、事件或剧本片段"
          onChange={(event) => setQuery(event.target.value)}
        />
        {visibleLoading ? <Loader2 size={16} className="animate-spin" /> : null}
      </div>

      {visibleError ? <p className="drama-story-graph-search-error">{visibleError}</p> : null}

      {trimmedQuery && !visibleLoading && !visibleError ? (
        <div className="drama-story-graph-search-meta">
          {visibleItems.length
            ? `找到 ${visibleItems.length} 条${visibleMode === 'semantic' ? '语义' : ''}结果`
            : '没有匹配结果，试试更短的关键词'}
        </div>
      ) : null}

      {visibleItems.length ? (
        <div className="drama-story-graph-search-results">
          {visibleItems.map((item) => (
            <button
              key={item.chunk_id}
              type="button"
              className={cn(
                'drama-story-graph-search-result',
                (item.entity_id || item.relation_id) && 'is-clickable',
              )}
              onClick={() => handleSelect(item)}
            >
              <div className="drama-story-graph-search-result-head">
                <span>{KIND_LABELS[item.chunk_kind] || item.chunk_kind}</span>
                <strong>{item.title || '未命名片段'}</strong>
                <em>{Math.round(item.score * 100)}%</em>
              </div>
              <p>{item.snippet}</p>
              {item.episode_number ? <small>第 {item.episode_number} 集</small> : null}
            </button>
          ))}
        </div>
      ) : null}

      {trimmedQuery && !visibleItems.length && !visibleLoading ? (
        <Button type="button" variant="ghost" size="sm" onClick={() => setQuery('')}>
          清空搜索
        </Button>
      ) : null}
    </section>
  )
}
