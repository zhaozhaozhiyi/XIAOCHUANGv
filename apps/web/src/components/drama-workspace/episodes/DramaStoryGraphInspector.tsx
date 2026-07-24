'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { Loader2, X } from 'lucide-react'
import { dramaAPI, type StoryGraphEntity, type StoryGraphRelation, type StoryGraphEntityDetailPayload } from '@/lib/api'
import { getAiErrorCopy } from '@/lib/ai-error-copy'
import { Button } from '@/components/ui/button'

type DramaStoryGraphInspectorProps = {
  dramaId: number
  entity: StoryGraphEntity | null
  relation: StoryGraphRelation | null
  onClose: () => void
}

export function DramaStoryGraphInspector({
  dramaId,
  entity,
  relation,
  onClose,
}: DramaStoryGraphInspectorProps) {
  const [detail, setDetail] = useState<StoryGraphEntityDetailPayload | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!entity) return
    let cancelled = false
    void (async () => {
      try {
        setLoading(true)
        setError(null)
        const payload = await dramaAPI.getStoryGraphEntity(dramaId, entity.id)
        if (!cancelled) setDetail(payload)
      } catch (err) {
        if (!cancelled) setError(getAiErrorCopy(err))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [dramaId, entity])

  if (!entity && !relation) return null

  const activeDetail = entity && detail?.entity.id === entity.id ? detail : null
  const activeError = entity ? error : null

  return (
    <aside className="drama-story-graph-inspector">
      <div className="drama-story-graph-inspector-head">
        <strong>{entity ? (entity.display_name || entity.canonical_name) : '关系详情'}</strong>
        <Button type="button" variant="ghost" size="icon" onClick={onClose}>
          <X size={16} />
        </Button>
      </div>

      {relation && !entity ? (
        <div className="drama-story-graph-inspector-body">
          <p className="drama-story-graph-inspector-kicker">关系</p>
          <h4>{relation.subject_name} → {relation.object_name}</h4>
          <p>{relation.predicate}</p>
          {relation.description ? <p className="drama-story-graph-inspector-muted">{relation.description}</p> : null}
        </div>
      ) : null}

      {entity ? (
        <div className="drama-story-graph-inspector-body">
          <p className="drama-story-graph-inspector-kicker">
            {entity.entity_type}{entity.role ? ` · ${entity.role}` : ''}
          </p>
          {entity.description ? <p>{entity.description}</p> : null}

          {loading ? (
            <div className="drama-story-graph-inspector-loading">
              <Loader2 size={16} className="animate-spin" />
              加载详情
            </div>
          ) : null}
          {activeError ? <p className="drama-story-graph-inspector-error">{activeError}</p> : null}

          {activeDetail?.aliases.length ? (
            <section>
              <h5>别名</h5>
              <div className="drama-story-graph-tag-list">
                {activeDetail.aliases.map((alias) => (
                  <span key={alias.id}>{alias.alias}</span>
                ))}
              </div>
            </section>
          ) : null}

          {activeDetail?.relations.length ? (
            <section>
              <h5>关系</h5>
              <ul className="drama-story-graph-inspector-list">
                {activeDetail.relations.map((item) => (
                  <li key={item.id}>
                    {item.subject_name} → {item.object_name} · {item.predicate}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {activeDetail?.entity.source_trace?.length ? (
            <section>
              <h5>证据</h5>
              <ul className="drama-story-graph-inspector-list">
                {activeDetail.entity.source_trace.map((trace, index) => (
                  <li key={index}>
                    {typeof trace.episode_number === 'number' ? `第 ${trace.episode_number} 集` : '剧本'}
                    {typeof trace.field === 'string' ? ` · ${trace.field}` : ''}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section>
            <h5>生产资产</h5>
            <p className="drama-story-graph-inspector-muted">
              {entity.seed_status === 'seeded' || entity.seed_status === 'linked'
                ? '已同步到资产库'
                : `当前状态：${entity.seed_status}`}
            </p>
            {entity.linked_character_id ? (
              <Link href={`/drama/${dramaId}/assets?tab=characters`} className="drama-stage-text-link">
                打开角色库
              </Link>
            ) : null}
          </section>
        </div>
      ) : null}
    </aside>
  )
}
