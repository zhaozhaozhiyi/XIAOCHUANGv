'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { Archive, Ellipsis, Filter, FolderHeart, Loader2, RefreshCw, RotateCcw, XCircle } from 'lucide-react'

import { BaseSelect } from '@/components/shared/base-select'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { dramaWorkspaceAPI, type DramaProjectAsset } from '@/lib/api'
import { staticUrl } from '@/lib/utils'

function prettySource(source: string | null | undefined) {
  const map: Record<string, string> = {
    drama_canvas: '画布',
    canvas_generation: '画布生成',
    canvas_upload: '画布上传',
    legacy_mainline: '历史主线',
    task: '生成任务',
  }
  return source ? map[source] || source : '项目素材'
}

function assetStatusLabel(status: string) {
  const map: Record<string, string> = {
    candidate: '候选',
    mainline: '主线',
    shot_private: '镜头私有',
    legacy_mainline: '历史主线',
    rejected: '已拒绝',
    archived: '已归档',
  }
  return map[status] || status
}

function reviewStatusLabel(status: DramaProjectAsset['review_status']) {
  const map: Record<DramaProjectAsset['review_status'], string> = {
    pending_confirmation: '待确认',
    confirmed: '已确认',
    rework_required: '需重做',
    stale: '需复核',
    archived: '已归档',
  }
  return map[status]
}

function roleLabel(role: string) {
  const map: Record<string, string> = {
    reference: '参考',
    character_portrait: '角色绑定图',
    scene_image: '场景绑定图',
    first_frame: '首帧',
    last_frame: '尾帧',
    shot_video: '镜头视频',
    voiceover: '配音',
    composed_video: '合成视频',
  }
  return map[role] || role
}

function mediaKindLabel(kind: DramaProjectAsset['kind']) {
  const map = {
    image: '图片',
    video: '视频',
    audio: '音频',
  } as const
  return map[kind]
}

function targetLabel(asset: DramaProjectAsset) {
  if (!asset.target_type) return '短剧项目'
  const typeLabels: Record<string, string> = {
    character: '角色',
    scene: '场景',
    storyboard: '分镜',
    episode: '剧集',
    drama: '短剧',
  }
  return `${typeLabels[asset.target_type] || asset.target_type}${asset.target_field ? ` / ${asset.target_field}` : ''}`
}

function extractShotTitle(title: string) {
  const match = title.match(/镜头标题[:：]\s*([^；;]+)/)
  return match?.[1]?.trim() || ''
}

function stripPromptNoise(title: string) {
  return title
    .replace(/；?画面描述[:：].*$/i, '')
    .replace(/^镜头标题[:：]\s*/i, '')
    .trim()
}

function assetDisplayTitle(asset: DramaProjectAsset) {
  if (asset.kind === 'audio') {
    const copy = asset.title.replace(/^音频\s*/i, '').trim()
    return copy ? `配音 · ${copy}` : '配音素材'
  }
  const shotTitle = extractShotTitle(asset.title)
  if (shotTitle) return shotTitle
  const cleaned = stripPromptNoise(asset.title)
  if (cleaned) return cleaned
  if (asset.storyboard_id) return `镜头素材 #${asset.storyboard_id}`
  return roleLabel(asset.role)
}

function assetDisplayMeta(asset: DramaProjectAsset) {
  const target = asset.storyboard_id
    ? '镜头素材'
    : asset.episode_id
      ? '单集素材'
      : '项目素材'
  const parts = [target, roleLabel(asset.role)].filter(Boolean)
  return parts.join(' · ')
}

function AssetPreview({ asset }: { asset: DramaProjectAsset }) {
  const preview = staticUrl(asset.thumbnail_url || asset.url || '')
  if (!preview) {
    return <div className="drama-asset-preview is-empty">{asset.kind}</div>
  }
  if (asset.kind === 'video') {
    return <video src={preview} className="drama-asset-preview" muted playsInline preload="metadata" />
  }
  if (asset.kind === 'audio') {
    return <div className="drama-asset-preview is-empty">音频</div>
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={preview} alt={asset.title} className="drama-asset-preview" />
}

type SecondaryAssetAction = {
  asset: DramaProjectAsset
  type: 'reject' | 'archive'
}

function isReviewVersionStale(error: unknown) {
  return error instanceof Error && error.message.includes('review_version_stale')
}

export function ProjectAssetsPanel({ dramaId }: { dramaId: number }) {
  const [items, setItems] = useState<DramaProjectAsset[]>([])
  const [selectedId, setSelectedId] = useState<number | string | null>(null)
  const [needsAttention, setNeedsAttention] = useState(true)
  const [reviewStatus, setReviewStatus] = useState<'' | DramaProjectAsset['review_status']>('')
  const [kind, setKind] = useState<'' | DramaProjectAsset['kind']>('')
  const [role, setRole] = useState('')
  const [q, setQ] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [commitTarget, setCommitTarget] = useState<DramaProjectAsset | null>(null)
  const [committing, setCommitting] = useState(false)
  const [secondaryAction, setSecondaryAction] = useState<SecondaryAssetAction | null>(null)
  const [applyingSecondaryAction, setApplyingSecondaryAction] = useState(false)
  const [conflictAssetId, setConflictAssetId] = useState<number | string | null>(null)
  const selected = items.find((item) => item.id === selectedId) ?? items[0] ?? null
  const hasAdvancedFilters = Boolean(kind || role || !needsAttention || reviewStatus)
  const reviewFilterLabel = needsAttention
    ? '需处理'
    : reviewStatus
      ? reviewStatusLabel(reviewStatus)
      : '全部素材'

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await dramaWorkspaceAPI.listProjectAssets(dramaId, {
        kind: kind || undefined,
        review_status: needsAttention ? undefined : reviewStatus || undefined,
        needs_attention: needsAttention || undefined,
        role: role || undefined,
        q: q.trim() || undefined,
        page_size: 80,
      }, { bypassCache: true })
      const visibleItems = res.items.filter((item) => {
        if (needsAttention) {
          return item.review_status === 'pending_confirmation'
            || item.review_status === 'rework_required'
            || item.review_status === 'stale'
        }
        return !reviewStatus || item.review_status === reviewStatus
      })
      setItems(visibleItems)
      setSelectedId((current) => visibleItems.some((item) => item.id === current) ? current : visibleItems[0]?.id ?? null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load()
    }, 0)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dramaId, needsAttention, reviewStatus, kind, role])

  const canConfirm = (asset: DramaProjectAsset) => typeof asset.id === 'number' && asset.review_status === 'pending_confirmation'
  const canCommit = (asset: DramaProjectAsset) => Boolean(
    asset.status === 'candidate'
    &&
    asset.target_type
    && asset.target_id
    && asset.target_field
    && asset.review_status === 'confirmed',
  )

  const confirm = async (asset: DramaProjectAsset) => {
    if (typeof asset.id !== 'number') return
    try {
      await dramaWorkspaceAPI.confirmProjectAssetLink(dramaId, {
        asset_link_id: asset.id,
        version_key: asset.version_key,
      })
      toast.success('素材已确认')
      setConflictAssetId(null)
      await load()
    } catch (err) {
      if (isReviewVersionStale(err)) {
        setConflictAssetId(asset.id)
        toast.error('素材已有更新', { description: '已保留当前选择，请刷新后重新确认。' })
        return
      }
      toast.error('确认失败', { description: err instanceof Error ? err.message : String(err) })
    }
  }

  const markRework = async (asset: DramaProjectAsset) => {
    if (typeof asset.id !== 'number') return
    try {
      await dramaWorkspaceAPI.requireProjectAssetRework(dramaId, {
        asset_link_id: asset.id,
        reason_code: 'user_marked',
        note: '用户标记需要重新生成。',
      })
      toast.success('已标记为需重做')
      await load()
    } catch (err) {
      toast.error('更新失败', { description: err instanceof Error ? err.message : String(err) })
    }
  }

  const applySecondaryAction = async () => {
    if (!secondaryAction) return
    try {
      setApplyingSecondaryAction(true)
      if (secondaryAction.type === 'reject') {
        await dramaWorkspaceAPI.rejectProjectAsset(dramaId, secondaryAction.asset.asset_id)
        toast.success('已拒绝候选素材')
      } else {
        await dramaWorkspaceAPI.archiveProjectAsset(dramaId, secondaryAction.asset.asset_id)
        toast.success('已归档素材')
      }
      setSecondaryAction(null)
      await load()
    } catch (err) {
      toast.error('操作失败', { description: err instanceof Error ? err.message : String(err) })
    } finally {
      setApplyingSecondaryAction(false)
    }
  }

  const refreshSelected = async () => {
    setConflictAssetId(null)
    await load()
  }

  const setReviewFilter = (value: 'attention' | '' | DramaProjectAsset['review_status']) => {
    setNeedsAttention(value === 'attention')
    setReviewStatus(value === 'attention' ? '' : value)
  }

  const commit = async () => {
    if (!commitTarget) return
    try {
      setCommitting(true)
      await dramaWorkspaceAPI.commitProjectAsset(dramaId, commitTarget.asset_id, {
        target_type: commitTarget.target_type as 'character' | 'scene' | 'storyboard',
        target_id: commitTarget.target_id!,
        target_field: commitTarget.target_field!,
        commit_scope: commitTarget.scope === 'storyboard' ? 'storyboard' : commitTarget.scope === 'episode' ? 'episode' : 'project',
        replace_existing: true,
      })
      toast.success('已提交到主线')
      setCommitTarget(null)
      await load()
    } catch (err) {
      toast.error('提交失败', { description: err instanceof Error ? err.message : String(err) })
    } finally {
      setCommitting(false)
    }
  }

  return (
    <TooltipProvider>
      <div className="drama-workspace-band drama-assets-panel">
        <div className="drama-workspace-section-head drama-assets-panel-head">
          <div>
            <h3>媒体素材</h3>
            <p>先处理需要确认、重做或复核的素材。</p>
          </div>
          <div className="drama-assets-panel-tools">
            <Popover>
              <Tooltip>
                <TooltipTrigger asChild>
                  <PopoverTrigger asChild>
                    <Button type="button" size="icon-sm" variant="outline" aria-label="高级筛选">
                      <Filter size={15} />
                    </Button>
                  </PopoverTrigger>
                </TooltipTrigger>
                <TooltipContent side="bottom">高级筛选</TooltipContent>
              </Tooltip>
              <PopoverContent align="end" className="drama-asset-filter-popover">
                <div className="drama-asset-filter-popover-head">
                  <strong>高级筛选</strong>
                  {hasAdvancedFilters ? <button type="button" className="drama-inline-link" onClick={() => { setKind(''); setRole(''); setReviewFilter('attention') }}>重置</button> : null}
                </div>
                <label className="drama-asset-filter-control">
                  <span>处理状态</span>
                  <BaseSelect
                    value={needsAttention ? 'attention' : reviewStatus}
                    onValueChange={(value) => setReviewFilter(value as 'attention' | '' | DramaProjectAsset['review_status'])}
                    options={[
                      { label: '需处理', value: 'attention' },
                      { label: '待确认', value: 'pending_confirmation' },
                      { label: '需重做', value: 'rework_required' },
                      { label: '已确认', value: 'confirmed' },
                      { label: '全部素材', value: '' },
                    ]}
                  />
                </label>
                <label className="drama-asset-filter-control">
                  <span>媒体类型</span>
                  <BaseSelect
                    value={kind}
                    onValueChange={(value) => setKind(value as '' | DramaProjectAsset['kind'])}
                    options={[
                      { label: '全部媒体', value: '' },
                      { label: '图片', value: 'image' },
                      { label: '视频', value: 'video' },
                      { label: '音频', value: 'audio' },
                    ]}
                  />
                </label>
                <label className="drama-asset-filter-control">
                  <span>用途</span>
                  <BaseSelect
                    value={role}
                    onValueChange={(value) => setRole(String(value))}
                    options={[
                      { label: '全部用途', value: '' },
                      { label: '首帧', value: 'first_frame' },
                      { label: '配音', value: 'voiceover' },
                      { label: '镜头视频', value: 'shot_video' },
                      { label: '角色绑定图', value: 'character_portrait' },
                      { label: '场景绑定图', value: 'scene_image' },
                    ]}
                  />
                </label>
              </PopoverContent>
            </Popover>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button type="button" size="icon-sm" variant="ghost" onClick={() => void load()} aria-label="刷新素材">
                  <RefreshCw size={15} />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">刷新素材</TooltipContent>
            </Tooltip>
          </div>
        </div>
        <div className="drama-assets-toolbar">
          <div className="drama-asset-current-filter" aria-label="当前素材视图">
            <span>当前视图</span>
            <strong>{reviewFilterLabel}</strong>
          </div>
          <label className="drama-inline-search">
            <Input value={q} onChange={(event) => setQ(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void load() }} placeholder="搜索素材" />
          </label>
        </div>
        {error ? <div className="drama-inline-error">{error}</div> : null}
        {loading ? <div className="drama-empty-inline"><Loader2 size={16} className="animate-spin" />加载媒体素材...</div> : null}
        {!loading && !items.length ? <div className="drama-empty-inline">暂无媒体素材。</div> : null}
        {!loading && items.length ? (
          <div className="drama-assets-workbench">
            <div className="drama-asset-grid">
              {items.map((asset) => (
                <button key={asset.id} type="button" className="drama-asset-tile" data-active={asset.id === selected?.id || undefined} onClick={() => setSelectedId(asset.id)}>
                  <AssetPreview asset={asset} />
                  <span><strong>{assetDisplayTitle(asset)}</strong><small>{reviewStatusLabel(asset.review_status)} · {assetDisplayMeta(asset)}</small></span>
                </button>
              ))}
            </div>
            <aside className="drama-asset-detail">
              {selected ? (
                <>
                  <AssetPreview asset={selected} />
                  <h4>{assetDisplayTitle(selected)}</h4>
                  {conflictAssetId === selected.id ? (
                    <div className="drama-asset-conflict" role="alert">
                      <span>素材版本已更新，请刷新后重新确认。</span>
                      <Button size="xs" variant="outline" onClick={() => void refreshSelected()}>刷新素材</Button>
                    </div>
                  ) : null}
                  <dl>
                    <div><dt>媒体</dt><dd>{mediaKindLabel(selected.kind)}</dd></div>
                    <div><dt>素材状态</dt><dd>{assetStatusLabel(selected.status)}</dd></div>
                    <div><dt>审核状态</dt><dd>{reviewStatusLabel(selected.review_status)}</dd></div>
                    <div><dt>用途</dt><dd>{roleLabel(selected.role)}</dd></div>
                    <div><dt>来源</dt><dd>{prettySource(selected.source_module)}</dd></div>
                    <div><dt>使用位置</dt><dd>{targetLabel(selected)}</dd></div>
                  </dl>
                  {selected.title !== assetDisplayTitle(selected) ? (
                    <details className="drama-asset-raw-details">
                      <summary>原始信息</summary>
                      <p>{selected.title}</p>
                    </details>
                  ) : null}
                  <div className="drama-detail-actions drama-asset-detail-actions">
                    {canConfirm(selected) ? <Button size="sm" onClick={() => void confirm(selected)}>确认可用</Button> : null}
                    {canCommit(selected) ? <Button size="sm" onClick={() => setCommitTarget(selected)}><FolderHeart size={14} />提交主线</Button> : null}
                    {selected.review_status === 'rework_required' ? <span className="drama-asset-action-hint">请从来源重新生成</span> : null}
                    <DropdownMenu>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <DropdownMenuTrigger asChild>
                            <Button type="button" size="icon-sm" variant="outline" aria-label="更多素材操作">
                              <Ellipsis size={16} />
                            </Button>
                          </DropdownMenuTrigger>
                        </TooltipTrigger>
                        <TooltipContent side="bottom">更多操作</TooltipContent>
                      </Tooltip>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem disabled={selected.review_status === 'rework_required'} onSelect={() => void markRework(selected)}>
                          <RotateCcw />标记需重做
                        </DropdownMenuItem>
                        {selected.source_canvas_id ? (
                          <DropdownMenuItem asChild>
                            <Link href={`/drama/${dramaId}/canvas/${selected.source_canvas_id}`}>打开来源画布</Link>
                          </DropdownMenuItem>
                        ) : null}
                        <DropdownMenuSeparator />
                        {selected.status === 'candidate' ? (
                          <DropdownMenuItem variant="destructive" onSelect={() => setSecondaryAction({ asset: selected, type: 'reject' })}>
                            <XCircle />拒绝候选
                          </DropdownMenuItem>
                        ) : null}
                        <DropdownMenuItem variant="destructive" onSelect={() => setSecondaryAction({ asset: selected, type: 'archive' })}>
                          <Archive />归档素材
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </>
              ) : <div className="drama-empty-inline">选择素材查看详情</div>}
            </aside>
          </div>
        ) : null}
      </div>
      <ConfirmDialog
        open={Boolean(commitTarget)}
        onOpenChange={(open) => {
          if (!open && !committing) setCommitTarget(null)
        }}
        title="提交媒体素材"
        description={
          commitTarget
            ? `将把“${commitTarget.title}”提交到 ${commitTarget.target_type || '项目'} / ${commitTarget.target_field || '目标字段'}。如果目标已有主线资产，系统会记录旧资产并覆盖。`
            : '确认提交当前素材。'
        }
        confirmLabel="确认提交"
        loading={committing}
        onConfirm={commit}
      />
      <ConfirmDialog
        open={Boolean(secondaryAction)}
        onOpenChange={(open) => {
          if (!open && !applyingSecondaryAction) setSecondaryAction(null)
        }}
        title={secondaryAction?.type === 'reject' ? '拒绝候选素材' : '归档素材'}
        description={secondaryAction?.type === 'reject'
          ? `“${secondaryAction.asset.title}”将不再参与后续审核与制作。`
          : secondaryAction
            ? `“${secondaryAction.asset.title}”将移入归档，不再显示在默认素材列表中。`
            : '确认当前操作。'}
        confirmLabel={secondaryAction?.type === 'reject' ? '确认拒绝' : '确认归档'}
        loading={applyingSecondaryAction}
        onConfirm={applySecondaryAction}
      />
    </TooltipProvider>
  )
}
