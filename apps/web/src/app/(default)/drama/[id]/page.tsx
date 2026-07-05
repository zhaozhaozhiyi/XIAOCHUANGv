'use client'

import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useRouter, useParams } from 'next/navigation'
import Image from 'next/image'
import { toast } from 'sonner'
import { AlertTriangle, BookOpen, CheckCircle2, Clock3, Eye, FileText, FileUp, LayoutGrid, Loader2, LogIn, Mic2, Mountain, Play, Plus, RefreshCw, Settings2, Sparkles, UserRound, Video, Wand2 } from 'lucide-react'
import { aiConfigAPI, dramaAPI, episodeAPI, imageAPI, writingAPI } from '@/lib/api'
import { getAiErrorCopy } from '@/lib/ai-error-copy'
import { dramaStyleLabel, dramaStyleSelectOptions } from '@/lib/drama-style'
import {
  buildDramaMetadataWithAdaptationPlan,
  buildDramaMetadataWithNovelSource,
  buildDramaMetadataWithProjectDefaults,
  getAdaptationPlan,
  getNovelSource,
  getProjectDefaults,
  type AdaptationPlan,
  type NovelSource,
  type NovelSourceChapter,
} from '@/lib/drama-metadata'
import {
  getDramaAspectRatioLabel,
  getDramaEpisodeCount,
  getNovelSourceHealth,
} from '@/lib/drama-product-state'
import { redirectToLoginFromCurrentLocation } from '@/lib/login-redirect'
import { staticUrl } from '@/lib/utils'
import { useAppSession } from '@/components/shared/app-session-provider'
import { Dialog, DialogActions, DialogContent, DialogDescription, DialogHeaderBar, DialogMain, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { BaseSelect } from '@/components/shared/base-select'
import type { AIServiceConfig, Drama, Episode, ImageGeneration, WritingListItem } from '@/types/api'

function hasScript(ep: Episode) {
  return !!(ep.script_content)
}

function formatEpisodeDuration(duration: number | null) {
  if (!duration) return '0 分钟'
  if (duration < 60) return `${duration} 秒`
  return `${Math.ceil(duration / 60)} 分钟`
}

function normalizePromptText(value: string | null | undefined) {
  return String(value || '')
    .replace(/[#*_`>\-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function truncatePromptText(value: string, maxLength: number) {
  if (value.length <= maxLength) return value
  return `${value.slice(0, maxLength)}...`
}

function buildNovelSummaryReference(drama: Drama) {
  const episodeSummary = (drama.episodes || [])
    .slice(0, 3)
    .map((episode) => normalizePromptText(episode.script_content || episode.content || episode.description))
    .filter(Boolean)
    .join(' ')

  const characterSummary = (drama.characters || [])
    .slice(0, 6)
    .map((character) => {
      const detail = normalizePromptText(character.description || character.appearance || character.personality)
      return detail ? `${character.name}：${detail}` : character.name
    })
    .filter(Boolean)
    .join('；')

  const sceneSummary = (drama.scenes || [])
    .slice(0, 6)
    .map((scene) => {
      const detail = normalizePromptText(scene.prompt)
      return detail ? `${scene.location || '场景'}：${detail}` : scene.location
    })
    .filter(Boolean)
    .join('；')

  return [
    drama.description ? `小说/项目总结：${normalizePromptText(drama.description)}` : '',
    episodeSummary ? `正文内容参考：${truncatePromptText(episodeSummary, 1200)}` : '',
    characterSummary ? `主要角色参考：${truncatePromptText(characterSummary, 500)}` : '',
    sceneSummary ? `关键场景参考：${truncatePromptText(sceneSummary, 500)}` : '',
  ].filter(Boolean).join('。')
}

function buildCoverPrompt(drama: Drama) {
  const summaryReference = buildNovelSummaryReference(drama)
  const details = [
    `短剧项目《${drama.title}》`,
    drama.genre ? `题材：${drama.genre}` : '',
    drama.style ? `视觉风格：${dramaStyleLabel(drama.style)}` : '',
    summaryReference,
  ].filter(Boolean).join('。')
  return `${details}。请严格参考以上小说内容、角色关系、关键场景和情绪基调生成封面，不要生成与故事无关的通用风景。生成一张 16:9 横版短剧封面图，电影级构图，主体明确，适合作为项目头图和海报背景，画面中不要出现文字、字幕、Logo、水印。`
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function episodePreviewText(ep: Episode) {
  return String(ep.script_content || ep.content || ep.description || '').trim()
}

function countNovelWords(content: string) {
  return content.replace(/\s/g, '').length
}

function formatCount(value: number) {
  if (value >= 10000) return `${(value / 10000).toFixed(value >= 100000 ? 1 : 2).replace(/\.0+$/, '')} 万`
  return value.toLocaleString()
}

function buildChapterIndex(content: string): NovelSourceChapter[] {
  const markerPattern = /(?:^|\n)\s*(?:#{1,6}\s*)?((?:第\s*[0-9０-９一二三四五六七八九十百千万零〇两俩]+\s*(?:章节|章|節|节|集))|(?:Chapter|CHAPTER)\s*[0-9０-９]+)(?:[：:、\-\s]+([^\n\r]{0,80}))?/g
  const matches = Array.from(content.matchAll(markerPattern))

  if (!matches.length) {
    const wordCount = countNovelWords(content)
    return wordCount
      ? [{ chapter_no: 1, title: '全文', word_count: wordCount, brief: content.slice(0, 80).replace(/\s+/g, ' ') }]
      : []
  }

  return matches.map((match, index) => {
    const start = (match.index || 0) + match[0].length
    const end = matches[index + 1]?.index ?? content.length
    const body = content.slice(start, end).trim()
    const title = [String(match[1] || '').trim(), String(match[2] || '').trim()].filter(Boolean).join('：')
    return {
      chapter_no: index + 1,
      title: title || `第 ${index + 1} 章`,
      word_count: countNovelWords(body),
      brief: body.slice(0, 80).replace(/\s+/g, ' '),
    }
  }).filter((chapter) => chapter.word_count > 0)
}

function pickChapterRange(chapters: NovelSourceChapter[], index: number, total: number) {
  if (!chapters.length) return '全文'
  const start = Math.floor((index / total) * chapters.length)
  const end = Math.max(start, Math.floor(((index + 1) / total) * chapters.length) - 1)
  const first = chapters[start]
  const last = chapters[Math.min(end, chapters.length - 1)]
  if (!first || !last) return '全文'
  return first.chapter_no === last.chapter_no
    ? first.title
    : `${first.title} - ${last.title}`
}

type AdaptationCharacter = AdaptationPlan['character_bible'][number]
type AdaptationScene = AdaptationPlan['scene_bible'][number]
type AdaptationTargetSettings = {
  aspectRhythm: string
  episodeDuration: string
  targetEpisodeCount: number
  visualStyle: string
}

function createTargetSettingsKey(settings: AdaptationTargetSettings) {
  return JSON.stringify(settings)
}

const CHARACTER_NAME_DENYLIST = new Set([
  '旁白',
  '画外音',
  '字幕',
  '音效',
  '系统',
  '大家',
  '我们',
  '你们',
  '他们',
  '客户',
  '用户',
  '企业',
  '工厂',
  '产品',
  '语速与字数基准',
  '镜头',
  '大屏',
  '静态大屏',
  '动图',
  '附录',
  '巨型数字',
  '智能排缸',
])

function normalizeCharacterName(value: string) {
  return value
    .replace(/^(镜头切|大屏切至|大屏切|切至|切到)/, '')
    .replace(/^(把时间交回|时间交回|交回|回到|有请|请回)/, '')
    .replace(/^谢谢/, '')
    .replace(/[《》「」“”"'（）()【】\[\]\s]/g, '')
    .trim()
}

function isLikelyCharacterName(value: string) {
  const name = normalizeCharacterName(value)
  if (!name || CHARACTER_NAME_DENYLIST.has(name)) return false
  if (/^[A-Z]$/.test(name)) return false
  if (name.length > 4 && !/(先生|女士|老师|博士|教授)$/.test(name)) return false
  if (/(概念|动图|页面|基准|结构|数据|矩阵|系统|模型|智能体|本体|大脑|产品|能力|行业|产业|工厂|方案|总述)/.test(name)) return false
  return /[\u4e00-\u9fa5]/.test(name)
}

function sentenceAround(content: string, index: number, size = 90) {
  const safeIndex = Math.max(0, index)
  const startSearch = Math.max(0, safeIndex - size)
  const endSearch = Math.min(content.length, safeIndex + size)
  const raw = content.slice(startSearch, endSearch)
  const parts = raw
    .split(/[\n。！？!?；;]/)
    .map((part) => part.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
  const containing = parts.find((part) => safeIndex === 0 || raw.indexOf(part) >= 0)
  return truncatePromptText(containing || parts[0] || raw.replace(/\s+/g, ' ').trim(), 120)
}

function collectCharacterCandidates(content: string) {
  const candidates = new Map<string, { name: string; count: number; snippets: string[] }>()
  const aliases = new Map<string, string>()

  function add(rawName: string, index: number, snippet?: string) {
    const name = normalizeCharacterName(rawName)
    if (!isLikelyCharacterName(name)) return
    const current = candidates.get(name) || { name, count: 0, snippets: [] }
    current.count += 1
    const nextSnippet = snippet || sentenceAround(content, index)
    if (nextSnippet && !current.snippets.includes(nextSnippet)) current.snippets.push(nextSnippet)
    candidates.set(name, current)
  }

  for (const match of content.matchAll(/([\u4e00-\u9fa5]{1,6})（([A-Z])）/g)) {
    const name = normalizeCharacterName(match[1] || '')
    const alias = String(match[2] || '').trim()
    if (name && alias) {
      aliases.set(alias, name)
      add(name, match.index || 0)
    }
  }

  for (const match of content.matchAll(/^([A-Z])\s*[：:]/gm)) {
    const rawName = String(match[1] || '').trim()
    const name = aliases.get(rawName) || rawName
    add(name, match.index || 0)
  }

  for (const match of content.matchAll(/([\u4e00-\u9fa5]{1,3}(?:总|老师|博士|先生|女士|教授))(?=主讲|开场|总结|讲|说|：|，|。|（|\s)/g)) {
    add(match[1] || '', match.index || 0)
  }

  for (const match of content.matchAll(/(马斯克|乔布斯|雷军|任正非|建刚)/g)) {
    add(match[1] || '', match.index || 0)
  }

  return [...candidates.values()]
    .sort((a, b) => {
      const aPriority = a.name.endsWith('总') ? 1 : 0
      const bPriority = b.name.endsWith('总') ? 1 : 0
      return bPriority - aPriority || b.count - a.count
    })
    .slice(0, 8)
}

function inferCharacterRole(candidate: { name: string; snippets: string[] }, index: number) {
  const text = `${candidate.name} ${candidate.snippets.join(' ')}`
  if (/建刚/.test(candidate.name)) return '案例讲解人'
  if (/主讲|开场|总结|发布|A[：:]/.test(text) || candidate.name.endsWith('总')) return '核心讲述者'
  if (/案例|落地|纺织/.test(text)) return '案例讲解人'
  if (/对标|特斯拉|超级工厂|太空|汽车|产线/.test(text)) return '参照人物'
  return index === 0 ? '核心角色' : '重要角色'
}

function buildCharacterDescription(candidate: { name: string; snippets: string[] }, role: string) {
  const reference = candidate.snippets[0] || ''
  if (reference) return `${role}。源稿线索：${reference}`
  return `${role}，从源稿中多次出现的人物。`
}

function buildCharacterAppearance(candidate: { name: string; snippets: string[] }, role: string) {
  const text = `${candidate.name} ${candidate.snippets.join(' ')}`
  if (/舞台|台前|大屏|发布会|主视觉/.test(text)) return `${role}形象；适合站立发布会、舞台灯光和大屏演示场景。`
  if (/案例|纺织|工厂|车间/.test(text)) return `${role}形象；适合产业现场、工厂案例和业务讲解场景。`
  if (/特斯拉|马斯克|太空|火箭|汽车/.test(text)) return `${role}形象；作为产业对标与愿景参照出现。`
  return `${role}形象；具体外貌可在后续分集制作中继续细化。`
}

function findExistingCharacterImage(drama: Drama, characterName: string) {
  const existing = (drama.characters || []).find((character) => character.name === characterName || character.name?.includes(characterName) || characterName.includes(character.name || ''))
  return existing?.image_url || ''
}

function buildCharacterImagePrompt(characterName: string, role: string, appearance: string, drama: Drama, snippets: string[] = []) {
  const styleLabel = drama.style ? dramaStyleLabel(drama.style) : '统一视觉风格'
  const reference = snippets.slice(0, 2).join('；')
  return `${styleLabel}角色设定图，${characterName}，${role}。${appearance}${reference ? ` 源稿线索：${reference}` : ''}。半身角色形象，主体清晰，适合短剧角色圣经，不出现文字、水印或Logo。`
}

function extractCharacterBibleFromSource(source: NovelSource, drama: Drama): AdaptationCharacter[] {
  const content = source.content || ''
  const candidates = collectCharacterCandidates(content)
  const characters = candidates.map((candidate, index) => {
    const role = inferCharacterRole(candidate, index)
    const appearance = buildCharacterAppearance(candidate, role)
    return {
      name: candidate.name,
      role,
      description: buildCharacterDescription(candidate, role),
      appearance,
      personality: candidate.snippets[1] ? `表达线索：${candidate.snippets[1]}` : '性格与表达方式待后续剧本拆解继续补全。',
      arc: candidate.snippets[2] ? `叙事线索：${candidate.snippets[2]}` : '围绕源稿中的职责和叙事功能展开。',
      voice_hint: role.includes('讲') || role.includes('述') ? '适合清晰、稳定、有发布会表达感的声音。' : '声音方向待后续配音阶段确定。',
      image_prompt: buildCharacterImagePrompt(candidate.name, role, appearance, drama, candidate.snippets),
      image_url: findExistingCharacterImage(drama, candidate.name),
    }
  })

  return characters.length
    ? characters
    : [{
      name: '待确认角色',
      role: '待确认角色',
      description: '当前源稿未识别到明确人物称谓，请在后续分集制作中继续补全角色。',
      appearance: '待根据源稿补全形象。',
      personality: '待补全。',
      arc: '待补全。',
      voice_hint: '待后续配音阶段确定。',
      image_prompt: `角色设定图，待确认角色，当前源稿未识别到明确人物称谓；画面暂以待补全角色形象占位，后续可补充姓名、身份、外貌、性格和关系定位。`,
      image_url: '',
    }]
}

function normalizeSceneSnippet(value: string) {
  return value
    .replace(/^\s*(?:\[|【|---)+/, '')
    .replace(/(?:\]|】|---)+\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function inferSceneName(snippet: string) {
  if (/舞台|台前|灯光|发布会|主视觉|开场/.test(snippet)) return '发布会主舞台'
  if (/纺织.*本体|本体.*结构|结构图/.test(snippet)) return '纺织本体演示屏'
  if (/数据层|多系统|系统示意|数据库|知识图谱/.test(snippet)) return '产业数据层'
  if (/超级工厂|产线|汽车|机器人|星舰|火箭/.test(snippet)) return '超级工厂产线'
  if (/工厂|车间|生产线|设备/.test(snippet)) return '工厂现场'
  if (/大屏|屏幕|演示|动图|图表/.test(snippet)) return '演示大屏'
  return truncatePromptText(snippet.replace(/[：:，。；;].*$/, ''), 12) || '源稿场景'
}

function inferSceneTimeHint(snippet: string) {
  if (/开场|主视觉|灯光起/.test(snippet)) return '开场建立'
  if (/演示|大屏|数据|结构图|动图/.test(snippet)) return '方案讲解'
  if (/案例|纺织|工厂|车间/.test(snippet)) return '案例展开'
  if (/结尾|收束|总结|回到/.test(snippet)) return '收束段落'
  return '按剧情需要复用'
}

function inferReuseLevel(count: number, snippet: string): 'high' | 'medium' | 'low' {
  if (count >= 3 || /主舞台|大屏|工厂|数据层/.test(snippet)) return 'high'
  if (count === 2 || /演示|案例|结构/.test(snippet)) return 'medium'
  return 'low'
}

function collectSceneCandidates(content: string, chapters: NovelSourceChapter[]) {
  const candidates = new Map<string, { name: string; count: number; snippets: string[] }>()

  function add(rawSnippet: string) {
    const snippet = normalizeSceneSnippet(rawSnippet)
    if (snippet.length < 4) return
    if (!/[\u4e00-\u9fa5]/.test(snippet)) return
    const name = inferSceneName(snippet)
    const current = candidates.get(name) || { name, count: 0, snippets: [] }
    current.count += 1
    if (!current.snippets.includes(snippet)) current.snippets.push(truncatePromptText(snippet, 120))
    candidates.set(name, current)
  }

  for (const match of content.matchAll(/[［\[]([^［\]\[\]]{4,140})[］\]]/g)) {
    add(match[1] || '')
  }

  for (const match of content.matchAll(/(?:^|\n)\s*(?:[-—]{2,}|#{1,6})\s*([^\n]{4,120})/g)) {
    add(match[1] || '')
  }

  for (const match of content.matchAll(/([^。\n]{0,28}(?:舞台|大屏|发布会|主视觉|工厂|车间|产线|本体结构|数据层|超级工厂|演示屏|结构图)[^。\n]{0,70})/g)) {
    add(match[1] || '')
  }

  if (!candidates.size) {
    for (const chapter of chapters.slice(0, 5)) {
      add(`${chapter.title}：${chapter.brief}`)
    }
  }

  return [...candidates.values()]
    .sort((a, b) => b.count - a.count || b.snippets.join('').length - a.snippets.join('').length)
    .slice(0, 6)
}

function findExistingSceneImage(drama: Drama, sceneName: string) {
  const existing = (drama.scenes || []).find((scene) => {
    const text = `${scene.location || ''} ${scene.prompt || ''}`
    return text.includes(sceneName) || sceneName.includes(String(scene.location || ''))
  })
  return existing?.image_url || ''
}

function buildSceneVisualPrompt(sceneName: string, snippets: string[], drama: Drama) {
  const styleLabel = drama.style ? dramaStyleLabel(drama.style) : '统一视觉风格'
  const reference = snippets.slice(0, 2).join('；')
  return `${styleLabel}场景图，${sceneName}，参考源稿线索：${reference}。画面用于短剧场景圣经，强调空间关系、光线、主体道具和可复用构图，不出现文字、水印或Logo。`
}

function extractSceneBibleFromSource(source: NovelSource, drama: Drama): AdaptationScene[] {
  const chapters = source.chapter_index || []
  const candidates = collectSceneCandidates(source.content || '', chapters)
  const sourceTitle = source.title || drama.title || '小说源稿'
  const scenes = candidates.map((candidate) => {
    const firstSnippet = candidate.snippets[0] || source.summary || sourceTitle
    const timeHint = inferSceneTimeHint(firstSnippet)
    return {
      name: candidate.name,
      location: candidate.name,
      time_hint: timeHint,
      visual_prompt: `源稿典型场景。线索：${firstSnippet}`,
      image_prompt: buildSceneVisualPrompt(candidate.name, candidate.snippets, drama),
      image_url: findExistingSceneImage(drama, candidate.name),
      reuse_level: inferReuseLevel(candidate.count, candidate.snippets.join(' ')),
    }
  })

  return scenes.length
    ? scenes
    : [{
      name: sourceTitle,
      location: sourceTitle,
      time_hint: '按剧情需要复用',
      visual_prompt: `围绕《${sourceTitle}》核心情绪设计的可复用主场景。`,
      image_prompt: `${drama.style ? dramaStyleLabel(drama.style) : '统一视觉风格'}场景图，《${sourceTitle}》核心空间，适合短剧场景圣经。`,
      image_url: '',
      reuse_level: 'high',
    }]
}

type AdaptationTargetOptions = {
  episodeDuration?: string
  visualStyle?: string
  aspectRhythm?: string
}

const EPISODE_DURATION_OPTIONS = [
  { label: '30-45 秒', value: '30-45 秒' },
  { label: '45-60 秒', value: '45-60 秒' },
  { label: '60-90 秒', value: '60-90 秒' },
  { label: '90-120 秒', value: '90-120 秒' },
]

const ASPECT_RHYTHM_OPTIONS = [
  { label: '16:9 · 高密度钩子', value: '16:9 · 高密度钩子' },
  { label: '9:16 · 竖屏强钩子', value: '9:16 · 竖屏强钩子' },
  { label: '1:1 · 社媒切片', value: '1:1 · 社媒切片' },
  { label: '16:9 · 电影化节奏', value: '16:9 · 电影化节奏' },
]

function buildDraftAdaptationPlan(source: NovelSource, drama: Drama, targetEpisodeCount = 24, options: AdaptationTargetOptions = {}): AdaptationPlan {
  const chapters = source.chapter_index || []
  const sourceTitle = source.title || drama.title || '小说源稿'
  const total = Math.max(1, targetEpisodeCount)
  const characterBible = extractCharacterBibleFromSource(source, drama)
  const leadName = characterBible[0]?.name || '核心角色'
  const sceneBible = extractSceneBibleFromSource(source, drama)
  const episodeDuration = options.episodeDuration?.trim() || '60-90 秒'
  const visualStyle = options.visualStyle?.trim() || drama.style || ''
  const aspectRhythm = options.aspectRhythm?.trim() || '16:9 · 高密度钩子'

  return {
    status: 'draft',
    target_episode_count: total,
    episode_duration: episodeDuration,
    logline: `围绕《${sourceTitle}》的核心冲突，压缩为高密度短剧节奏。`,
    tone: visualStyle ? `${dramaStyleLabel(visualStyle)} · 情绪钩子优先` : '情绪钩子优先',
    main_plot: source.summary || `从 ${formatCount(source.word_count)} 字原文中提炼主线，优先保留人物目标、反转节点和结尾悬念。`,
    character_bible: characterBible,
    scene_bible: sceneBible,
    visual_style: visualStyle,
    aspect_rhythm: aspectRhythm,
    episode_outlines: Array.from({ length: total }).map((_, index) => {
      const episodeNumber = index + 1
      const sourceRange = pickChapterRange(chapters, index, total)
      const sceneName = sceneBible[index % sceneBible.length]?.name || '核心场景'
      return {
        episode_number: episodeNumber,
        title: `第${episodeNumber}集：${episodeNumber === 1 ? '开局钩子' : episodeNumber === total ? '终局反转' : '冲突升级'}`,
        source_range: sourceRange,
        hook: episodeNumber === 1 ? '用原文最强事件开场，快速建立主角困境。' : '承接上一集悬念，开场 5 秒给出新信息。',
        key_beats: [
          '明确本集目标',
          '制造一次关系或信息反转',
          '把冲突推向下一集',
        ],
        ending_hook: episodeNumber === total ? '主线闭合，同时保留可续作余味。' : '留下一个必须点击下一集的悬念。',
        characters: [leadName],
        scenes: [sceneName],
      }
    }),
    generated_at: new Date().toISOString(),
    source_imported_at: source.imported_at,
  }
}

function CharacterBibleCard({ character, compact = false, onOpen }: { character: AdaptationCharacter; compact?: boolean; onOpen: (character: AdaptationCharacter) => void }) {
  const imageUrl = character.image_url ? staticUrl(character.image_url) : ''
  const title = character.name || '待确认角色'

  return (
    <div className="overflow-hidden rounded-[10px] border border-border bg-bg-0">
      <div className="grid gap-0 sm:grid-cols-[132px_minmax(0,1fr)]">
        <div className="relative min-h-[132px] bg-bg-2">
          {imageUrl ? (
            <Image src={imageUrl} alt={title} fill sizes="132px" className="object-cover" unoptimized />
          ) : (
            <div className="flex size-full min-h-[132px] flex-col justify-between bg-[linear-gradient(135deg,color-mix(in_srgb,var(--color-accent)_14%,transparent),color-mix(in_srgb,var(--color-bg-2)_92%,var(--color-border)))] p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="rounded-full border border-border/70 bg-bg-0/80 px-2 py-1 text-[11px] font-semibold text-text-2">角色图提示</span>
                <UserRound size={16} className="text-accent" />
              </div>
              <div className="text-sm font-semibold leading-5 text-text-0">{title}</div>
            </div>
          )}
        </div>
        <div className="min-w-0 p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-text-0">{title}</div>
              <div className="mt-1 text-xs text-accent-text">{character.role || '角色'}</div>
            </div>
            <Button type="button" variant="ghost" size="sm" className="h-7 shrink-0 rounded-[8px] px-2 text-xs" onClick={() => onOpen(character)}>
              详情
            </Button>
          </div>
          <p className={`mt-2 text-xs leading-5 text-text-2 ${compact ? 'line-clamp-3' : ''}`}>{character.description || character.arc}</p>
          {character.appearance ? (
            <p className={`mt-2 text-xs leading-5 text-text-3 ${compact ? 'line-clamp-2' : ''}`}>形象：{character.appearance}</p>
          ) : null}
          {character.personality || character.voice_hint ? (
            <p className={`mt-1 text-xs leading-5 text-text-3 ${compact ? 'line-clamp-2' : ''}`}>表达：{character.personality || character.voice_hint}</p>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function CharacterBibleDialog({ character, onClose }: { character: AdaptationCharacter | null; onClose: () => void }) {
  const imageUrl = character?.image_url ? staticUrl(character.image_url) : ''
  const title = character?.name || '角色详情'
  const role = character?.role || '待确认角色'
  const detailItems = character ? [
    ['形象设定', character.appearance || '待根据源稿补全形象。'],
    ['表达方式', character.personality || '待补全。'],
    ['人物弧光', character.arc || '待补全。'],
    ['声音方向', character.voice_hint || '待后续配音阶段确定。'],
    ['画面提示', character.image_prompt || '角色设定图，待确认角色，当前源稿未识别到明确人物称谓；画面需保持干净、主体明确。'],
  ] : []

  return (
    <Dialog open={Boolean(character)} onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent
        aria-describedby="character-bible-dialog-description"
        className="flex max-h-[min(88dvh,780px)] w-[calc(100vw-2rem)] max-w-[920px] flex-col gap-0 overflow-hidden rounded-[28px] border-border/70 bg-bg-0 p-0 shadow-shadow-elevated sm:max-w-[920px]"
      >
        <DialogHeaderBar className="border-b border-border/60 bg-bg-0/95 px-6 py-5 sm:px-8 sm:py-6">
          <div className="flex items-start justify-between gap-5 pr-11">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex h-7 items-center rounded-full bg-bg-2 px-3 text-xs font-semibold text-accent-text">{role}</span>
                <span className="text-xs font-medium text-text-3">角色档案</span>
              </div>
              <DialogTitle className="mt-3 font-body text-[28px] font-semibold leading-none tracking-[-0.026em] text-text-0">
                {title}
              </DialogTitle>
              <DialogDescription id="character-bible-dialog-description" className="mt-2 max-w-[56ch] text-sm leading-6 text-text-2">
                查看角色介绍、视觉设定、表达方式、人物弧光、声音方向和画面提示。
              </DialogDescription>
            </div>
          </div>
        </DialogHeaderBar>

        <DialogMain className="min-h-0 flex-1 overflow-y-auto px-6 py-6 sm:px-8">
          {character ? (
            <div className="grid gap-6 lg:grid-cols-[minmax(240px,0.86fr)_minmax(0,1.24fr)]">
              <aside className="lg:sticky lg:top-0 lg:self-start">
                <div className="overflow-hidden rounded-[30px] bg-bg-2 shadow-shadow-sm">
                  <div className="relative aspect-[3/4] min-h-[320px] bg-[linear-gradient(145deg,var(--color-bg-2),var(--color-bg-0))]">
                  {imageUrl ? (
                    <Image src={imageUrl} alt={title} fill sizes="260px" className="object-cover" unoptimized />
                  ) : (
                      <div className="flex size-full flex-col justify-between p-5">
                        <span className="w-fit rounded-full bg-bg-0/75 px-3 py-1 text-xs font-semibold text-text-2 shadow-shadow-xs">角色图提示</span>
                        <div className="flex flex-1 items-center justify-center">
                          <div className="flex size-24 items-center justify-center rounded-full bg-bg-0/80 text-accent shadow-shadow-sm">
                            <UserRound size={42} strokeWidth={1.6} />
                          </div>
                        </div>
                        <div className="rounded-[22px] bg-bg-0/78 p-4 backdrop-blur-sm">
                          <div className="text-lg font-semibold leading-tight tracking-[-0.012em] text-text-0">{title}</div>
                          <p className="mt-2 text-sm leading-6 text-text-2">{character.appearance || '待根据源稿补全形象。'}</p>
                        </div>
                      </div>
                  )}
                  {imageUrl ? (
                    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/55 to-transparent p-5 text-white">
                      <div className="text-lg font-semibold leading-tight tracking-[-0.012em]">{title}</div>
                      <p className="mt-1 text-sm text-white/80">{role}</p>
                    </div>
                  ) : null}
                  </div>
                </div>
                <div className="mt-3 rounded-[22px] bg-bg-2/70 px-4 py-3">
                  <div className="text-xs font-semibold text-text-3">角色图提示</div>
                  <p className="mt-1 line-clamp-3 text-xs leading-5 text-text-2">
                    {character.image_prompt || '角色设定图，待确认角色，当前源稿未识别到明确人物称谓。'}
                  </p>
                </div>
              </aside>

              <div className="min-w-0">
                <section className="rounded-[28px] bg-bg-2/70 p-5 sm:p-6">
                  <div className="text-xs font-semibold tracking-[0.08em] text-text-3">PROFILE</div>
                  <h3 className="mt-3 font-body text-xl font-semibold tracking-[-0.018em] text-text-0">角色介绍</h3>
                  <p className="mt-3 text-[15px] leading-7 text-text-1">
                    {character.description || '当前源稿未识别到明确人物称谓，请在后续分集制作中继续补全角色。'}
                  </p>
                </section>

                <div className="mt-4 overflow-hidden rounded-[28px] bg-bg-2/70">
                  {detailItems.map(([label, value], index) => (
                    <section key={label} className={`px-5 py-4 sm:px-6 ${index > 0 ? 'border-t border-border/70' : ''}`}>
                      <div className="text-xs font-semibold text-accent-text">{label}</div>
                      <p className="mt-2 text-sm leading-7 text-text-2">{value}</p>
                    </section>
                  ))}
                </div>
              </div>
            </div>
          ) : null}
        </DialogMain>
      </DialogContent>
    </Dialog>
  )
}

function SceneBibleCard({ scene, compact = false }: { scene: AdaptationScene; compact?: boolean }) {
  const imageUrl = scene.image_url ? staticUrl(scene.image_url) : ''
  const reuseLabel = scene.reuse_level === 'high' ? '高复用' : scene.reuse_level === 'low' ? '低复用' : '中复用'

  return (
    <div className="overflow-hidden rounded-[10px] border border-border bg-bg-0">
      <div className="relative aspect-[16/9] bg-bg-2">
        {imageUrl ? (
          <Image src={imageUrl} alt={scene.name || scene.location || '场景图'} fill sizes="(min-width: 768px) 360px, 100vw" className="object-cover" unoptimized />
        ) : (
          <div className="flex size-full flex-col justify-between bg-[linear-gradient(135deg,color-mix(in_srgb,var(--color-accent)_16%,transparent),color-mix(in_srgb,var(--color-bg-2)_92%,var(--color-border)))] p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="rounded-full border border-border/70 bg-bg-0/80 px-2 py-1 text-[11px] font-semibold text-text-2">场景图提示</span>
              <Mountain size={16} className="text-accent" />
            </div>
            <div className="text-sm font-semibold leading-5 text-text-0">{scene.name || scene.location}</div>
          </div>
        )}
      </div>
      <div className="p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-text-0">{scene.name || scene.location}</div>
            <div className="mt-1 text-xs text-accent-text">{reuseLabel} · {scene.time_hint || '按剧情需要复用'}</div>
          </div>
        </div>
        <p className={`mt-2 text-xs leading-5 text-text-2 ${compact ? 'line-clamp-3' : ''}`}>{scene.visual_prompt || scene.time_hint}</p>
        {scene.image_prompt ? (
          <p className={`mt-2 text-xs leading-5 text-text-3 ${compact ? 'line-clamp-2' : ''}`}>画面：{scene.image_prompt}</p>
        ) : null}
      </div>
    </div>
  )
}

export default function DramaDetailPage() {
  const router = useRouter()
  const params = useParams()
  const { authenticated } = useAppSession()
  const dramaId = Number(params.id)
  const redirectedForeignDramaRef = useRef(false)

  const [drama, setDrama] = useState<Drama | null>(null)
  const [loading, setLoading] = useState(true)
  const [addDialog, setAddDialog] = useState(false)
  const [splitDialog, setSplitDialog] = useState(false)
  const [previewVideoUrl, setPreviewVideoUrl] = useState<string | null>(null)
  const [previewVideoTitle, setPreviewVideoTitle] = useState('')
  const [creating, setCreating] = useState(false)
  const [splitting, setSplitting] = useState(false)
  const [projectDefaultsDialogOpen, setProjectDefaultsDialogOpen] = useState(false)
  const [coverGenerating, setCoverGenerating] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [splitContent, setSplitContent] = useState('')
  const [activeTab, setActiveTab] = useState<'episodes' | 'characters' | 'scenes' | 'source' | 'plan'>('episodes')
  const [previewScriptEpisode, setPreviewScriptEpisode] = useState<Episode | null>(null)
  const [aiConfigs, setAiConfigs] = useState<AIServiceConfig[]>([])
  const [defaultsSaving, setDefaultsSaving] = useState(false)
  const [sourceDialogOpen, setSourceDialogOpen] = useState(false)
  const [sourceDialogMode, setSourceDialogMode] = useState<'edit' | 'view'>('edit')
  const [sourceTitleDraft, setSourceTitleDraft] = useState('')
  const [sourceContentDraft, setSourceContentDraft] = useState('')
  const [sourceSaving, setSourceSaving] = useState(false)
  const [sourcePickerOpen, setSourcePickerOpen] = useState(false)
  const [writingSources, setWritingSources] = useState<WritingListItem[]>([])
  const [writingSourceLoading, setWritingSourceLoading] = useState(false)
  const [writingSourceQuery, setWritingSourceQuery] = useState('')
  const [writingSourceImportingId, setWritingSourceImportingId] = useState<number | null>(null)
  const [planGenerating, setPlanGenerating] = useState(false)
  const [episodesGenerating, setEpisodesGenerating] = useState(false)
  const [targetSaving, setTargetSaving] = useState(false)
  const targetAutosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastSavedTargetKeyRef = useRef('')
  const [planTargetEpisodes, setPlanTargetEpisodes] = useState(24)
  const [planEpisodeDuration, setPlanEpisodeDuration] = useState('60-90 秒')
  const [planVisualStyle, setPlanVisualStyle] = useState('')
  const [planAspectRhythm, setPlanAspectRhythm] = useState('16:9 · 高密度钩子')
  const [planTab, setPlanTab] = useState<'episodes' | 'characters' | 'scenes'>('episodes')
  const [selectedPlanCharacter, setSelectedPlanCharacter] = useState<AdaptationCharacter | null>(null)
  const [projectDefaults, setProjectDefaults] = useState({
    image_config_id: '',
    video_config_id: '',
    audio_config_id: '',
  })

  const episodes = useMemo(() => drama?.episodes || [], [drama?.episodes])
  const imageConfigOptions = useMemo(
    () => [{ label: '跟随系统默认', value: '' }, ...aiConfigs.filter((item) => item.service_type === 'image').map((item) => ({ label: item.name, value: String(item.id) }))],
    [aiConfigs],
  )
  const videoConfigOptions = useMemo(
    () => [{ label: '跟随系统默认', value: '' }, ...aiConfigs.filter((item) => item.service_type === 'video').map((item) => ({ label: item.name, value: String(item.id) }))],
    [aiConfigs],
  )
  const audioConfigOptions = useMemo(
    () => [{ label: '跟随系统默认', value: '' }, ...aiConfigs.filter((item) => item.service_type === 'audio').map((item) => ({ label: item.name, value: String(item.id) }))],
    [aiConfigs],
  )
  const hasActiveImageConfig = useMemo(
    () => aiConfigs.some((item) => item.service_type === 'image' && Number(item.is_active) === 1),
    [aiConfigs],
  )
  const missingConfigHints = useMemo(
    () => [
      aiConfigs.some((item) => item.service_type === 'image' && Number(item.is_active) === 1) ? null : '图片模型',
      aiConfigs.some((item) => item.service_type === 'video' && Number(item.is_active) === 1) ? null : '视频模型',
      aiConfigs.some((item) => item.service_type === 'audio' && Number(item.is_active) === 1) ? null : '配音模型',
    ].filter(Boolean) as string[],
    [aiConfigs],
  )
  const readOnly = useMemo(
    () => Boolean(drama?.read_only) || !authenticated,
    [authenticated, drama?.read_only],
  )
  const novelSource = useMemo(() => getNovelSource(drama), [drama])
  const adaptationPlan = useMemo(() => getAdaptationPlan(drama), [drama])
  const novelSourceHealth = useMemo(() => getNovelSourceHealth(novelSource), [novelSource])
  const hasSourceIssue = Boolean(novelSource) && !novelSourceHealth.ok
  const hasUsableNovelSource = Boolean(novelSource) && novelSourceHealth.ok
  const displayEpisodeCount = useMemo(() => getDramaEpisodeCount(drama), [drama])
  const displayAspectRatio = useMemo(() => getDramaAspectRatioLabel(drama), [drama])
  const sourceDialogHealth = useMemo(() => {
    if (!sourceContentDraft.trim()) return getNovelSourceHealth(null)
    return getNovelSourceHealth({
      type: 'paste',
      title: sourceTitleDraft.trim() || drama?.title || '',
      content: sourceContentDraft,
      word_count: 0,
      chapter_count: 0,
      imported_at: '',
    })
  }, [drama?.title, sourceContentDraft, sourceTitleDraft])
  const sourceDraftWordCount = useMemo(() => countNovelWords(sourceContentDraft), [sourceContentDraft])
  const sourceDraftChapterCount = useMemo(() => buildChapterIndex(sourceContentDraft).length || 0, [sourceContentDraft])
  const sourceDialogHasBlockingIssue = Boolean(sourceContentDraft.trim()) && sourceDialogHealth.kind !== 'valid' && sourceDialogHealth.kind !== 'missing'
  const targetSettings = useMemo<AdaptationTargetSettings>(() => ({
    aspectRhythm: planAspectRhythm.trim() || '16:9 · 高密度钩子',
    episodeDuration: planEpisodeDuration.trim() || '60-90 秒',
    targetEpisodeCount: Math.min(120, Math.max(1, Number(planTargetEpisodes) || 1)),
    visualStyle: planVisualStyle.trim(),
  }), [planAspectRhythm, planEpisodeDuration, planTargetEpisodes, planVisualStyle])
  const targetSettingsKey = useMemo(() => createTargetSettingsKey(targetSettings), [targetSettings])

  const openLoginNextHere = useCallback(() => {
    redirectToLoginFromCurrentLocation()
  }, [])
  const nextEpisode = useMemo(
    () => episodes.find((episode) => !hasScript(episode)) ?? episodes[0] ?? null,
    [episodes],
  )
  const coverBusy = coverGenerating

  const applyTargetSettings = useCallback((nextDrama: Drama) => {
    const plan = getAdaptationPlan(nextDrama)
    const targetEpisodeCount = plan?.target_episode_count || nextDrama.total_episodes || 24
    const episodeDuration = plan?.episode_duration || '60-90 秒'
    const visualStyle = plan?.visual_style || nextDrama.style || ''
    const aspectRhythm = plan?.aspect_rhythm || '16:9 · 高密度钩子'
    setPlanTargetEpisodes(targetEpisodeCount)
    setPlanEpisodeDuration(episodeDuration)
    setPlanVisualStyle(visualStyle)
    setPlanAspectRhythm(aspectRhythm)
    lastSavedTargetKeyRef.current = createTargetSettingsKey({
      aspectRhythm,
      episodeDuration,
      targetEpisodeCount,
      visualStyle,
    })
  }, [])

  const load = useCallback(async () => {
    try {
      setLoading(true)
      const d = await dramaAPI.get(dramaId, { redirectOnUnauthorized: false }) as unknown as Drama
      setDrama(d)
      applyTargetSettings(d)
      const defaults = getProjectDefaults(d)
      setProjectDefaults({
        image_config_id: defaults.image_config_id ? String(defaults.image_config_id) : '',
        video_config_id: defaults.video_config_id ? String(defaults.video_config_id) : '',
        audio_config_id: defaults.audio_config_id ? String(defaults.audio_config_id) : '',
      })
    } catch (e: unknown) {
      toast.error('加载短剧项目失败', { description: getAiErrorCopy(e) })
    } finally {
      setLoading(false)
    }
  }, [applyTargetSettings, dramaId])

  useEffect(() => {
    redirectedForeignDramaRef.current = false
    let cancelled = false
    async function init() {
      const authed = authenticated
      try {
        if (!cancelled) setLoading(true)
        const [d, configRows] = await Promise.all([
          dramaAPI.get(dramaId, { redirectOnUnauthorized: false }) as Promise<Drama>,
          aiConfigAPI.list(),
        ])
        if (!cancelled && authed && d.read_only) {
          if (!redirectedForeignDramaRef.current) {
            redirectedForeignDramaRef.current = true
            toast.info('这是其他用户的项目，无法在站内编辑，已为你返回首页')
          }
          router.replace('/')
        } else if (!cancelled) {
          setDrama(d)
          setAiConfigs(Array.isArray(configRows) ? configRows : [])
          applyTargetSettings(d)
          const defaults = getProjectDefaults(d)
          setProjectDefaults({
            image_config_id: defaults.image_config_id ? String(defaults.image_config_id) : '',
            video_config_id: defaults.video_config_id ? String(defaults.video_config_id) : '',
            audio_config_id: defaults.audio_config_id ? String(defaults.audio_config_id) : '',
          })
        }
      } catch (e: unknown) {
        if (!cancelled) toast.error('加载短剧项目失败', { description: getAiErrorCopy(e) })
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void init()
    return () => {
      cancelled = true
    }
  }, [applyTargetSettings, authenticated, dramaId, router])

  async function addEpisode() {
    try {
      setCreating(true)
      const created = await episodeAPI.create({
        drama_id: dramaId,
        title: newTitle || undefined,
      }) as Episode
      toast.success('已添加新集')
      setAddDialog(false)
      window.location.href = `/drama/${dramaId}/episode/${created.episode_number}`
    } catch (e: unknown) {
      toast.error('添加分集失败', { description: getAiErrorCopy(e) })
    } finally {
      setCreating(false)
    }
  }

  async function splitEpisodes() {
    const content = splitContent.trim()
    const replaceExisting = !content && episodes.length === 1
    if (!content && !replaceExisting) {
      toast.warning('请输入剧本内容')
      return
    }
    try {
      setSplitting(true)
      const result = await dramaAPI.splitEpisodes(dramaId, {
        content: content || undefined,
        replace_existing: replaceExisting,
      })
      toast.success(`已自动创建 ${result.count} 集`)
      setSplitDialog(false)
      setSplitContent('')
      await load()
    } catch (e: unknown) {
      toast.error('拆分分集失败', { description: getAiErrorCopy(e) })
    } finally {
      setSplitting(false)
    }
  }

  async function generateCover() {
    if (!drama || coverBusy) return
    if (!hasActiveImageConfig) {
      toast.warning('未找到可用图片模型配置', { description: '请先在设置中启用图片 AI 配置，或为项目选择默认图片模型。' })
      return
    }
    try {
      setCoverGenerating(true)
      const record = await imageAPI.generate({
        drama_id: drama.id,
        prompt: buildCoverPrompt(drama),
        size: '1920x1080',
        frame_type: 'drama_cover',
      }) as ImageGeneration
      const generationId = record.id
      toast.success('已开始生成封面')
      for (let attempt = 0; attempt < 90; attempt += 1) {
        await sleep(2000)
        const latest = await imageAPI.get(generationId)
        if (latest.status === 'completed') {
          const thumbnail = latest.image_url || null
          if (thumbnail) {
            setDrama((current) => current ? { ...current, thumbnail } : current)
            await load()
            toast.success('封面已生成')
            return
          }
        }
        if (latest.status === 'failed') {
          throw new Error(latest.error_msg || '封面生成失败')
        }
      }
      toast.warning('封面仍在生成中，稍后刷新页面查看')
    } catch (e: unknown) {
      toast.error('封面生成失败', { description: getAiErrorCopy(e) })
    } finally {
      setCoverGenerating(false)
    }
  }

  async function saveProjectDefaults() {
    if (!drama) return
    try {
      setDefaultsSaving(true)
      const metadata = buildDramaMetadataWithProjectDefaults(drama.metadata, {
        image_config_id: projectDefaults.image_config_id ? Number(projectDefaults.image_config_id) : null,
        video_config_id: projectDefaults.video_config_id ? Number(projectDefaults.video_config_id) : null,
        audio_config_id: projectDefaults.audio_config_id ? Number(projectDefaults.audio_config_id) : null,
        lead_character_name: '',
        lead_character_description: '',
        lead_voice_id: '',
        voice_notes: '',
      })
      await dramaAPI.update(drama.id, { metadata })
      setDrama((current) => current ? { ...current, metadata: JSON.stringify(metadata) } : current)
      toast.success('项目默认设定已保存')
    } catch (e: unknown) {
      toast.error('保存项目默认设定失败', { description: getAiErrorCopy(e) })
    } finally {
      setDefaultsSaving(false)
    }
  }

  function openSourceDialog(mode: 'edit' | 'view') {
    if (mode === 'view' && !novelSource) return
    setSourceDialogMode(mode)
    setSourceTitleDraft(novelSource?.title || drama?.title || '')
    setSourceContentDraft(novelSource?.content || '')
    setSourceDialogOpen(true)
  }

  async function saveNovelSource() {
    if (!drama || readOnly) return
    const content = sourceContentDraft.trim()
    if (!content) {
      toast.warning('请先粘贴小说源稿')
      return
    }

    try {
      setSourceSaving(true)
      const chapterIndex = buildChapterIndex(content)
      const source: NovelSource = {
        type: 'paste',
        title: sourceTitleDraft.trim() || drama.title,
        content,
        word_count: countNovelWords(content),
        chapter_count: chapterIndex.length,
        imported_at: new Date().toISOString(),
        summary: content.slice(0, 220).replace(/\s+/g, ' '),
        chapter_index: chapterIndex,
      }
      const sourceHealth = getNovelSourceHealth(source)
      if (!sourceHealth.ok) {
        toast.warning(sourceHealth.message)
        return
      }
      const metadata = buildDramaMetadataWithNovelSource(drama.metadata, source)
      await dramaAPI.update(drama.id, { metadata })
      setDrama((current) => current ? { ...current, metadata: JSON.stringify(metadata) } : current)
      setSourceDialogOpen(false)
      toast.success('小说源稿已保存，旧改编规划已失效')
    } catch (e: unknown) {
      toast.error('保存小说源稿失败', { description: getAiErrorCopy(e) })
    } finally {
      setSourceSaving(false)
    }
  }

  async function loadWritingSources(query = writingSourceQuery) {
    try {
      setWritingSourceLoading(true)
      const result = await writingAPI.list({
        page: 1,
        page_size: 30,
        kind: 'novel',
        sort: 'updated_at',
        q: query.trim() || undefined,
      })
      setWritingSources(Array.isArray(result.items) ? result.items : [])
    } catch (e: unknown) {
      toast.error('加载小说作品失败', { description: getAiErrorCopy(e) })
    } finally {
      setWritingSourceLoading(false)
    }
  }

  function openWritingSourcePicker() {
    if (readOnly) return
    setWritingSourceQuery('')
    setSourcePickerOpen(true)
    void loadWritingSources('')
  }

  async function importWritingSource(item: WritingListItem) {
    if (!drama || readOnly) return
    try {
      setWritingSourceImportingId(item.id)
      const { blob } = await writingAPI.exportMarkdown(item.id)
      const content = (await blob.text()).trim()
      if (!content) {
        toast.warning('这个小说作品还没有可导入正文')
        return
      }
      const chapterIndex = buildChapterIndex(content)
      const source: NovelSource = {
        type: 'writing_project',
        title: item.title || drama.title,
        content,
        word_count: countNovelWords(content),
        chapter_count: chapterIndex.length,
        imported_at: new Date().toISOString(),
        summary: (item.synopsis || content.slice(0, 220)).replace(/\s+/g, ' '),
        chapter_index: chapterIndex,
      }
      const sourceHealth = getNovelSourceHealth(source)
      if (!sourceHealth.ok) {
        toast.warning(sourceHealth.message)
        return
      }
      const metadata = buildDramaMetadataWithNovelSource(drama.metadata, source)
      await dramaAPI.update(drama.id, { metadata })
      setDrama((current) => current ? { ...current, metadata: JSON.stringify(metadata) } : current)
      setSourcePickerOpen(false)
      toast.success('已从小说模块引入源稿，旧改编规划已失效')
    } catch (e: unknown) {
      toast.error('导入小说源稿失败', { description: getAiErrorCopy(e) })
    } finally {
      setWritingSourceImportingId(null)
    }
  }

  const saveAdaptationTargets = useCallback(async (options: { silent?: boolean } = {}) => {
    if (!drama || readOnly) return

    const {
      aspectRhythm,
      episodeDuration,
      targetEpisodeCount,
      visualStyle,
    } = targetSettings

    try {
      setTargetSaving(true)
      let metadata = drama.metadata

      if (hasUsableNovelSource && novelSource) {
        const nextDrama = { ...drama, style: visualStyle || null }
        const plan = buildDraftAdaptationPlan(novelSource, nextDrama, targetEpisodeCount, {
          episodeDuration,
          visualStyle,
          aspectRhythm,
        })
        metadata = JSON.stringify(buildDramaMetadataWithAdaptationPlan(drama.metadata, plan))
      }

      await dramaAPI.update(drama.id, {
        style: visualStyle || null,
        metadata: metadata ? JSON.parse(metadata) : undefined,
        total_episodes: targetEpisodeCount,
      })

      setDrama((current) => current ? {
        ...current,
        style: visualStyle || null,
        total_episodes: targetEpisodeCount,
        metadata,
      } : current)
      setPlanTargetEpisodes(targetEpisodeCount)
      setPlanEpisodeDuration(episodeDuration)
      setPlanAspectRhythm(aspectRhythm)
      lastSavedTargetKeyRef.current = createTargetSettingsKey({
        aspectRhythm,
        episodeDuration,
        targetEpisodeCount,
        visualStyle,
      })
      setPlanTab('episodes')
      if (!options.silent) {
        toast.success(hasUsableNovelSource ? '改编目标已保存，方案草稿已更新' : hasSourceIssue ? '改编目标已保存，请先修复源稿后再生成草稿' : '改编目标已保存')
      }
    } catch (e: unknown) {
      toast.error('保存改编目标失败', { description: getAiErrorCopy(e) })
    } finally {
      setTargetSaving(false)
    }
  }, [drama, hasSourceIssue, hasUsableNovelSource, novelSource, readOnly, targetSettings])

  useEffect(() => {
    if (!drama || readOnly || !novelSource) return
    if (lastSavedTargetKeyRef.current === targetSettingsKey) return

    if (targetAutosaveTimerRef.current) clearTimeout(targetAutosaveTimerRef.current)
    targetAutosaveTimerRef.current = setTimeout(() => {
      void saveAdaptationTargets({ silent: true })
    }, 700)

    return () => {
      if (targetAutosaveTimerRef.current) clearTimeout(targetAutosaveTimerRef.current)
    }
  }, [drama, novelSource, readOnly, saveAdaptationTargets, targetSettingsKey])

  async function generateAdaptationPlan() {
    if (!drama || readOnly) return
    if (!novelSource) {
      toast.warning('请先导入小说源稿')
      return
    }
    if (!novelSourceHealth.ok) {
      toast.warning(novelSourceHealth.message)
      return
    }

    try {
      setPlanGenerating(true)
      const plan = buildDraftAdaptationPlan(novelSource, { ...drama, style: planVisualStyle || drama.style }, planTargetEpisodes, {
        episodeDuration: planEpisodeDuration,
        visualStyle: planVisualStyle,
        aspectRhythm: planAspectRhythm,
      })
      const metadata = buildDramaMetadataWithAdaptationPlan(drama.metadata, plan)
      await dramaAPI.update(drama.id, { style: planVisualStyle || drama.style || null, metadata })
      setDrama((current) => current ? { ...current, style: planVisualStyle || drama.style, metadata: JSON.stringify(metadata) } : current)
      setPlanTab('episodes')
      toast.success('方案草稿已生成')
    } catch (e: unknown) {
      toast.error('生成方案草稿失败', { description: getAiErrorCopy(e) })
    } finally {
      setPlanGenerating(false)
    }
  }

  async function createEpisodesFromPlan(options: { navigateToEpisodeNumber?: number } = {}) {
    if (!drama || !adaptationPlan || readOnly) return
    if (!novelSourceHealth.ok) {
      toast.warning(novelSourceHealth.message)
      return
    }
    if (episodes.length > 0) {
      toast.warning('当前项目已有分集，第一期暂不覆盖已有分集')
      return
    }

    try {
      setEpisodesGenerating(true)
      let targetCreatedEpisode: Episode | null = null
      for (const outline of adaptationPlan.episode_outlines) {
        const created = await episodeAPI.create({
          drama_id: drama.id,
          title: outline.title,
        }) as Episode
        if (created.episode_number === options.navigateToEpisodeNumber) {
          targetCreatedEpisode = created
        }
        const draftContent = [
          `# ${outline.title}`,
          '',
          outline.source_range ? `原文范围：${outline.source_range}` : '',
          outline.hook ? `开场钩子：${outline.hook}` : '',
          outline.key_beats.length ? `关键节拍：\n${outline.key_beats.map((beat, index) => `${index + 1}. ${beat}`).join('\n')}` : '',
          outline.ending_hook ? `结尾悬念：${outline.ending_hook}` : '',
          outline.characters.length ? `出场角色：${outline.characters.join('、')}` : '',
          outline.scenes.length ? `核心场景：${outline.scenes.join('、')}` : '',
        ].filter(Boolean).join('\n\n')
        await episodeAPI.update(created.id, {
          content: draftContent,
          description: outline.hook || outline.ending_hook || '',
        })
      }
      const confirmedPlan: AdaptationPlan = {
        ...adaptationPlan,
        status: 'confirmed',
      }
      const metadata = buildDramaMetadataWithAdaptationPlan(drama.metadata, confirmedPlan)
      await dramaAPI.update(drama.id, { metadata })
      setDrama((current) => current ? { ...current, metadata: JSON.stringify(metadata) } : current)
      toast.success(`已生成 ${adaptationPlan.episode_outlines.length} 个分集`)
      await load()
      if (options.navigateToEpisodeNumber) {
        router.push(`/drama/${drama.id}/episode/${targetCreatedEpisode?.episode_number ?? options.navigateToEpisodeNumber}`)
        return
      }
      setActiveTab('episodes')
    } catch (e: unknown) {
      toast.error('生成分集失败', { description: getAiErrorCopy(e) })
    } finally {
      setEpisodesGenerating(false)
    }
  }

  async function openPlanEpisode(episodeNumber: number) {
    if (!drama) return
    if (readOnly) {
      toast.info('登录后可进入分集工作台')
      return
    }

    const existingEpisode = episodes.find((episode) => episode.episode_number === episodeNumber)
    if (existingEpisode) {
      router.push(`/drama/${drama.id}/episode/${existingEpisode.episode_number}`)
      return
    }

    if (episodes.length > 0) {
      toast.warning('当前项目已有分集，但没有找到对应集数，请从分集卡片进入。')
      setActiveTab('episodes')
      return
    }

    await createEpisodesFromPlan({ navigateToEpisodeNumber: episodeNumber })
  }

  if (loading) {
    return (
      <div className="page-shell bg-bg-base text-text-0 animate-fade-up">
        <div className="mx-auto w-full">
          <section className="relative min-h-[320px] overflow-hidden rounded-[10px] border border-border bg-bg-0 shadow-shadow-sm">
            <div
              className="absolute inset-0 opacity-[0.18]"
              style={{
                backgroundImage: 'linear-gradient(color-mix(in srgb, var(--color-border) 70%, transparent) 1px, transparent 1px), linear-gradient(90deg, color-mix(in srgb, var(--color-border) 70%, transparent) 1px, transparent 1px)',
                backgroundSize: '51px 51px',
              }}
              aria-hidden
            />
            <div className="relative flex min-h-[320px] flex-col justify-between p-4 sm:p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="flex size-10 animate-pulse items-center justify-center rounded-[10px] border border-border bg-bg-surface">
                  <div className="size-5 rounded-[5px] bg-bg-2" />
                </div>
                <div className="mr-[7%] flex w-full max-w-[360px] flex-col items-start gap-4 pt-7">
                  <div className="h-9 w-40 animate-pulse rounded-[var(--radius-sm)] bg-bg-2" />
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="h-8 w-16 animate-pulse rounded-full bg-bg-2" />
                    <div className="h-8 w-14 animate-pulse rounded-full bg-bg-2" />
                    <div className="h-8 w-14 animate-pulse rounded-full bg-bg-2" />
                  </div>
                </div>
              </div>

              <div className="pointer-events-none absolute left-1/2 top-1/2 hidden h-[136px] w-[120px] -translate-x-1/2 -translate-y-1/2 animate-pulse rounded-[14px] border border-dashed border-border bg-bg-panel md:flex md:flex-col md:items-center md:justify-center md:gap-3">
                <div className="size-9 rounded-[10px] bg-bg-2" />
                <div className="h-4 w-14 rounded-full bg-bg-2" />
              </div>

              <div className="flex items-end justify-end gap-3">
                <div className="flex h-11 w-[106px] animate-pulse items-center justify-center gap-2 rounded-[10px] bg-accent-bg">
                  <div className="size-4 rounded-[4px] bg-accent-glow" />
                  <div className="h-4 w-14 rounded-full bg-accent-glow" />
                </div>
                <div className="flex size-11 animate-pulse items-center justify-center rounded-[8px] border border-border bg-bg-surface">
                  <div className="size-4 rounded-[4px] bg-bg-2" />
                </div>
              </div>
            </div>
          </section>

          <section className="mt-5">
            <div className="h-8 w-28 animate-pulse rounded-[var(--radius-sm)] bg-bg-2" />
            <div className="mt-5 flex h-[42px] w-full max-w-[500px] animate-pulse items-center gap-1 rounded-[9px] border border-border bg-bg-2 p-1">
              {[0, 1, 2].map((item) => (
                <div key={item} className={`flex h-8 flex-1 items-center justify-center gap-2 rounded-[8px] ${item === 0 ? 'bg-bg-0' : ''}`}>
                  <div className="size-4 rounded-[4px] bg-bg-3" />
                  <div className="h-4 w-14 rounded-full bg-bg-3" />
                </div>
              ))}
            </div>
            <div className="mt-5 grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(360px,1fr)]">
              <div className="flex min-h-[308px] animate-pulse flex-col items-center justify-center rounded-[12px] border border-dashed border-accent-glow bg-accent-bg px-6 py-10 text-center">
                <div className="size-[54px] rounded-[14px] bg-accent-glow" />
                <div className="mt-6 h-7 w-48 rounded-[var(--radius-sm)] bg-accent-glow" />
                <div className="mt-3 h-5 w-72 max-w-full rounded-full bg-accent-glow" />
                <div className="mt-7 h-10 w-[104px] rounded-[11px] bg-accent-glow" />
              </div>
              <div className="flex min-h-[308px] animate-pulse flex-col items-center justify-center rounded-[12px] border border-dashed border-border-strong bg-bg-0 px-6 py-10 text-center">
                <div className="size-11 rounded-[12px] bg-bg-2" />
                <div className="mt-5 h-5 w-28 rounded-full bg-bg-2" />
                <div className="mt-3 h-5 w-44 rounded-full bg-bg-2" />
              </div>
            </div>
          </section>
        </div>
      </div>
    )
  }

  if (!drama) return null

  const coverUrl = staticUrl(drama.thumbnail)
  const hasEpisodes = episodes.length > 0
  const tabs = [
    { key: 'episodes' as const, label: '分集列表', icon: LayoutGrid, count: episodes.length },
    { key: 'characters' as const, label: '角色', icon: UserRound, count: drama.characters?.length || 0 },
    { key: 'scenes' as const, label: '场景', icon: Mountain, count: drama.scenes?.length || 0 },
    ...(novelSource ? [{ key: 'source' as const, label: '原稿', icon: BookOpen, count: 1 }] : []),
    ...(adaptationPlan ? [{ key: 'plan' as const, label: '方案草稿', icon: Wand2, count: adaptationPlan.target_episode_count }] : []),
  ]

  return (
    <div className="page-shell bg-bg-base text-text-0 animate-fade-up">
      <div className="mx-auto w-full">
      {readOnly ? (
        <div className="mb-5 flex flex-col gap-3 rounded-[14px] border border-border bg-bg-0 px-4 py-3.5 shadow-shadow-xs sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <p className="text-sm leading-6 text-text-2">
            当前为<strong className="font-semibold text-text-0">只读浏览</strong>：可查看项目与分集信息；创作、分集、生成与进入制作页需登录且为项目作者。
          </p>
          <Button type="button" variant="outline" size="sm" className="h-9 shrink-0 gap-2 rounded-[10px]" onClick={openLoginNextHere}>
            <LogIn size={15} />
            登录后创作
          </Button>
        </div>
      ) : null}
      <section className="relative h-[100px] overflow-hidden bg-bg-0 shadow-shadow-sm">
        <div
          className="absolute inset-0"
          style={{
            backgroundImage: coverUrl
              ? `linear-gradient(90deg, color-mix(in srgb, var(--color-bg-0) 76%, transparent) 0%, color-mix(in srgb, var(--color-bg-0) 62%, transparent) 48%, var(--color-bg-0) 100%), url(${coverUrl})`
              : 'linear-gradient(105deg, var(--color-bg-2) 0%, var(--color-bg-0) 50%, var(--color-bg-surface) 100%)',
            backgroundSize: 'cover',
            backgroundPosition: 'center',
          }}
          aria-hidden
        />
        <div
          className="absolute inset-0 opacity-[0.18]"
          style={{
            backgroundImage: 'linear-gradient(color-mix(in srgb, var(--color-border) 70%, transparent) 1px, transparent 1px), linear-gradient(90deg, color-mix(in srgb, var(--color-border) 70%, transparent) 1px, transparent 1px)',
            backgroundSize: '51px 51px',
          }}
          aria-hidden
        />
        <div className="relative flex h-full items-center justify-between gap-4 px-4 py-0 sm:px-5">
          <div className="flex min-w-0 flex-col justify-center text-left">
            <h1 className="truncate font-body text-[24px] font-black leading-tight tracking-normal text-text-0 sm:text-[26px]">
              {drama.title}
            </h1>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="inline-flex h-7 items-center bg-accent-bg px-3 text-xs font-medium text-accent-text">
                {drama.style ? dramaStyleLabel(drama.style) : '通用'}
              </span>
              <span className="inline-flex h-7 items-center bg-bg-2 px-3 text-xs text-text-2">{displayAspectRatio}</span>
              <span className="inline-flex h-7 items-center bg-bg-2 px-3 text-xs text-text-2">{displayEpisodeCount} 集</span>
            </div>
          </div>

          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
            {!readOnly ? (
              <>
                {!coverUrl ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-9 rounded-[8px] border border-border bg-bg-surface text-text-1 hover:bg-bg-hover hover:text-text-0"
                    aria-label="AI 生成项目封面"
                    title="AI 生成项目封面"
                    disabled={coverBusy}
                    onClick={generateCover}
                  >
                    {coverGenerating ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} fill="currentColor" strokeWidth={0} />}
                  </Button>
                ) : null}
              </>
            ) : (
              <Button type="button" variant="default" className="h-9 rounded-[9px] px-4 text-sm font-bold" onClick={openLoginNextHere}>
                <LogIn size={16} />
                登录后编辑
              </Button>
            )}
          </div>
        </div>
      </section>

      <section className="mt-5">
        <h2 className="font-body text-2xl font-black tracking-normal text-text-0">创作中枢</h2>

        {!readOnly && !hasEpisodes ? (
          <div className="mt-5 space-y-5">
            <div className="flex flex-wrap items-center gap-2 text-xs text-text-2">
              <span
                className={`rounded-full border px-3 py-1.5 font-semibold ${
                  hasUsableNovelSource ? 'border-border bg-bg-2 text-text-2' : 'border-accent-glow bg-accent-bg text-accent-text'
                }`}
                aria-current={!hasUsableNovelSource ? 'step' : undefined}
              >
                01 小说源稿
              </span>
              <span className="text-text-3">→</span>
              <span
                className={`rounded-full border px-3 py-1.5 font-semibold ${
                  hasUsableNovelSource ? 'border-accent-glow bg-accent-bg text-accent-text' : 'border-border bg-bg-2 text-text-2'
                }`}
                aria-current={hasUsableNovelSource ? 'step' : undefined}
              >
                02 方案草稿
              </span>
              <span className="text-text-3">→</span>
              <span className="rounded-full border border-border bg-bg-2 px-3 py-1.5 font-semibold">03 分集制作</span>
            </div>
            {!novelSource ? (
            <section className="rounded-[14px] border border-border bg-bg-0 p-5 shadow-shadow-xs">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-base font-semibold text-text-0">
                    <span className="inline-flex size-7 items-center justify-center rounded-full bg-accent text-xs font-black text-on-accent">01</span>
                    <BookOpen size={16} />
                    添加小说 / 导入原稿
                  </div>
                  <p className="mt-1 text-sm leading-6 text-text-2">
                    刚创建的项目从这里开始，先导入整本小说或原始文本。
                  </p>
                </div>
              </div>

              <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1.18fr)_minmax(0,0.82fr)]">
                <button
                  type="button"
                  onClick={openWritingSourcePicker}
                  className="group flex min-h-[188px] flex-col items-start justify-between rounded-[12px] border border-accent-glow bg-accent-bg px-5 py-5 text-left transition-colors hover:border-accent hover:bg-bg-hover"
                >
                  <div className="flex size-11 items-center justify-center rounded-[10px] border border-accent-glow bg-bg-0 text-accent shadow-shadow-xs">
                    <BookOpen size={22} />
                  </div>
                  <div className="mt-6">
                    <h3 className="font-body text-lg font-black tracking-normal text-text-0 group-hover:text-accent">从小说模块引入</h3>
                    <p className="mt-2 max-w-xl text-sm leading-6 text-text-2">
                      选择已有小说作品，自动导出全文作为源稿；适合从创作工作台进入短剧改编。
                    </p>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => openSourceDialog('edit')}
                  className="group flex min-h-[188px] flex-col items-start justify-between rounded-[12px] border border-dashed border-border-strong bg-bg-0 px-5 py-5 text-left transition-colors hover:border-accent hover:bg-bg-hover"
                >
                  <div className="flex size-11 items-center justify-center rounded-[10px] border border-border bg-bg-2 text-text-2 group-hover:text-accent">
                    <FileUp size={22} />
                  </div>
                  <div className="mt-6">
                    <h3 className="font-body text-base font-black tracking-normal text-text-0">粘贴 / 导入原稿</h3>
                    <p className="mt-2 text-sm leading-6 text-text-2">
                      直接粘贴整本小说全文，保存后统计字数、章节并进入方案草稿。
                    </p>
                  </div>
                </button>
              </div>
            </section>
            ) : null}

            {novelSource ? (
            <section className="space-y-5">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-base font-semibold text-text-0">
                    <span className="inline-flex size-7 items-center justify-center rounded-full bg-accent text-xs font-black text-on-accent">
                      {hasSourceIssue ? '01' : '02'}
                    </span>
                    {hasSourceIssue ? <AlertTriangle size={16} className="text-warning" /> : <Wand2 size={16} />}
                    {hasSourceIssue ? '修复小说源稿' : '方案草稿'}
                  </div>
                  <p className="mt-1 text-sm leading-6 text-text-2">
                    {hasSourceIssue
                      ? '当前源稿还不能用于改编，请先重新导入或粘贴完整正文。'
                      : '基于整本小说确定制作默认设定、角色圣经、场景圣经和分集大纲，再进入分集制作。'}
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-9 shrink-0 rounded-full border-0 bg-bg-2/80 px-3 shadow-none hover:bg-bg-hover"
                    onClick={() => setProjectDefaultsDialogOpen(true)}
                  >
                    <Settings2 size={14} />
                    配置默认值
                  </Button>
                  <Button type="button" variant="ghost" size="sm" className="h-9 rounded-full bg-bg-2/80 px-3 shadow-none hover:bg-bg-hover" onClick={() => openSourceDialog('view')}>
                    <Eye size={13} />
                    查看原稿
                  </Button>
                </div>
              </div>

              {hasSourceIssue ? (
                <div role="alert" className="mt-4 rounded-[12px] border border-warning/30 bg-warning-bg px-4 py-3">
                  <div className="flex items-start gap-2">
                    <AlertTriangle size={16} className="mt-0.5 shrink-0 text-warning" />
                    <div>
                      <div className="text-sm font-semibold text-warning">请先修复源稿再继续改编</div>
                      <p className="mt-1 text-sm leading-6 text-text-2">
                        {novelSourceHealth.message} 当前方案草稿仅适合排查问题，不建议继续生成分集。
                      </p>
                    </div>
                  </div>
                </div>
              ) : null}

                <div className="py-1">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0">
                    <div className="flex items-center gap-2 text-sm font-semibold text-text-0">
                      <span className="inline-flex size-6 items-center justify-center rounded-full bg-bg-2/80 text-xs font-semibold text-accent-text">A</span>
                      改编目标
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2 text-xs font-medium text-text-3">
                    {targetSaving ? <Loader2 size={13} className="animate-spin text-accent" /> : <CheckCircle2 size={13} className="text-accent" />}
                    {targetSaving ? '正在同步' : '更改后自动生效'}
                  </div>
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <label className="block min-w-0">
                    <span className="text-xs font-medium text-text-3">目标集数</span>
                    <div className="mt-2 flex items-center gap-2">
                      <Input
                        type="number"
                        min={1}
                        max={120}
                        value={planTargetEpisodes}
                        onChange={(event) => setPlanTargetEpisodes(Math.min(120, Math.max(1, Number(event.target.value) || 1)))}
                        className="h-10 rounded-[12px] border-0 bg-bg-2/80 px-4 text-sm font-semibold shadow-none"
                        aria-label="目标集数"
                      />
                    </div>
                  </label>
                  <label className="block min-w-0">
                    <span className="text-xs font-medium text-text-3">单集时长</span>
                    <BaseSelect
                      className="mt-2 [&_button]:h-10 [&_button]:rounded-[12px] [&_button]:border-0 [&_button]:bg-bg-2/80 [&_button]:px-4 [&_button]:text-sm [&_button]:font-semibold [&_button]:shadow-none [&_button:hover]:border-0 [&_button:hover]:bg-bg-hover"
                      value={planEpisodeDuration}
                      onValueChange={(value) => setPlanEpisodeDuration(String(value))}
                      options={EPISODE_DURATION_OPTIONS}
                      placeholder="选择时长"
                      searchable={false}
                    />
                  </label>
                  <label className="block min-w-0">
                    <span className="text-xs font-medium text-text-3">视觉风格</span>
                    <BaseSelect
                      className="mt-2 [&_button]:h-10 [&_button]:rounded-[12px] [&_button]:border-0 [&_button]:bg-bg-2/80 [&_button]:px-4 [&_button]:text-sm [&_button]:font-semibold [&_button]:shadow-none [&_button:hover]:border-0 [&_button:hover]:bg-bg-hover"
                      value={planVisualStyle}
                      onValueChange={(value) => setPlanVisualStyle(String(value))}
                      options={dramaStyleSelectOptions}
                      placeholder="选择风格"
                      searchable={false}
                    />
                  </label>
                  <label className="block min-w-0">
                    <span className="text-xs font-medium text-text-3">画幅节奏</span>
                    <BaseSelect
                      className="mt-2 [&_button]:h-10 [&_button]:rounded-[12px] [&_button]:border-0 [&_button]:bg-bg-2/80 [&_button]:px-4 [&_button]:text-sm [&_button]:font-semibold [&_button]:shadow-none [&_button:hover]:border-0 [&_button:hover]:bg-bg-hover"
                      value={planAspectRhythm}
                      onValueChange={(value) => setPlanAspectRhythm(String(value))}
                      options={ASPECT_RHYTHM_OPTIONS}
                      placeholder="选择画幅"
                      searchable={false}
                    />
                  </label>
                </div>
              </div>

              <div className="py-1">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-sm font-semibold text-text-0">
                      <span className="inline-flex size-6 items-center justify-center rounded-full bg-bg-2/80 text-xs font-semibold text-accent-text">B</span>
                      方案草稿
                    </div>
                  </div>
                  {adaptationPlan ? (
                    <span
                      className={`inline-flex h-7 shrink-0 items-center text-xs font-semibold ${
                        hasSourceIssue
                          ? 'text-warning'
                          : 'text-accent-text'
                      }`}
                    >
                      {hasSourceIssue ? '待重新生成' : '草稿已生成'}
                    </span>
                  ) : null}
                </div>

              {!adaptationPlan ? (
                <div className="mt-6 flex min-h-[188px] flex-col items-center justify-center px-6 py-8 text-center">
                  <Sparkles size={36} className="text-text-3" strokeWidth={1.8} />
                  <h3 className="mt-4 font-body text-lg font-black tracking-normal text-text-0">等待生成方案草稿</h3>
                  <p className="mt-2 max-w-md text-sm leading-6 text-text-2">
                    {hasSourceIssue
                      ? '当前原稿内容异常，请先修复或更换源稿，再生成可用的方案草稿。'
                      : novelSource
                        ? '将根据源稿快速生成目标集数、主线、角色圣经、场景圣经和分集大纲；这一步不消耗 AI 额度，后续分集制作再调用 AI。'
                        : '请先导入小说源稿，再生成方案草稿。'}
                  </p>
                  {hasSourceIssue ? (
                    <Button type="button" className="mt-5 h-9 rounded-[9px]" onClick={() => openSourceDialog('edit')}>
                      <RefreshCw size={14} />
                      修复源稿
                    </Button>
                  ) : (
                    <Button type="button" className="mt-5 h-9 rounded-[9px]" disabled={!hasUsableNovelSource || planGenerating} onClick={generateAdaptationPlan}>
                      {planGenerating ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />}
                      生成方案草稿
                    </Button>
                  )}
                </div>
              ) : (
                <div className="mt-4">
                  {hasSourceIssue ? (
                    <div role="alert" className="mb-4 rounded-[12px] border border-warning/30 bg-warning-bg px-4 py-3">
                      <div className="text-sm font-semibold text-warning">当前方案基于异常源稿生成</div>
                      <p className="mt-1 text-sm leading-6 text-text-2">
                        请先修复原稿，再重新生成方案草稿；在此之前不建议继续确认分集。
                      </p>
                    </div>
                  ) : null}
                  <div className="rounded-[18px] bg-accent-bg/70 p-4">
                    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                      <div>
                        <div className="text-sm font-semibold text-text-0">目标：{adaptationPlan.target_episode_count} 集 · 每集 {adaptationPlan.episode_duration}</div>
                        <p className="mt-1 text-sm leading-6 text-text-2">{adaptationPlan.logline || adaptationPlan.main_plot}</p>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        className="h-9 rounded-full px-4"
                        disabled={episodesGenerating || episodes.length > 0}
                        onClick={hasSourceIssue ? () => openSourceDialog('edit') : () => { void createEpisodesFromPlan() }}
                        title={
                          hasSourceIssue
                            ? '打开源稿编辑，修复后重新生成方案'
                            : episodes.length > 0
                              ? '当前项目已有分集，第一期不会覆盖已有分集'
                              : '根据当前规划生成分集'
                        }
                      >
                        {episodesGenerating ? <Loader2 size={14} className="animate-spin" /> : hasSourceIssue ? <RefreshCw size={14} /> : <CheckCircle2 size={14} />}
                        {hasSourceIssue ? '修复源稿' : episodes.length > 0 ? '分集已存在' : '确认生成分集'}
                      </Button>
                    </div>
                  </div>

                  <div className="mt-4 flex rounded-full bg-bg-2/80 p-1">
                    {[
                      { key: 'episodes' as const, label: '分集大纲', count: adaptationPlan.episode_outlines.length },
                      { key: 'characters' as const, label: '角色圣经', count: adaptationPlan.character_bible.length },
                      { key: 'scenes' as const, label: '场景圣经', count: adaptationPlan.scene_bible.length },
                    ].map((item) => (
                      <button
                        key={item.key}
                        type="button"
                        onClick={() => setPlanTab(item.key)}
                        className={`flex h-8 min-w-0 flex-1 items-center justify-center gap-2 rounded-full px-3 text-sm font-bold transition-colors ${
                          planTab === item.key ? 'bg-bg-0 text-text-0 shadow-shadow-xs' : 'text-text-1 hover:bg-bg-hover'
                        }`}
                      >
                        <span className="truncate">{item.label}</span>
                        <span className="inline-flex size-5 items-center justify-center rounded-full bg-accent text-xs text-on-accent">{item.count}</span>
                      </button>
                    ))}
                  </div>

                  <div className="mt-4">
                    {planTab === 'episodes' ? (
                      <div className="space-y-2">
                        {adaptationPlan.episode_outlines.map((episode) => (
                          <button
                            key={episode.episode_number}
                            type="button"
                            className="group w-full rounded-[14px] bg-bg-2/70 px-4 py-3 text-left transition-[background,box-shadow,transform] hover:bg-bg-hover hover:shadow-shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/35 disabled:cursor-wait disabled:opacity-70"
                            disabled={episodesGenerating}
                            onClick={() => { void openPlanEpisode(episode.episode_number) }}
                          >
                            <div className="flex items-center justify-between gap-3">
                              <div className="min-w-0 truncate text-sm font-semibold text-text-0">{episode.title}</div>
                              <div className="flex shrink-0 items-center gap-2 text-xs">
                                <span className="text-text-3">{episode.source_range || '待定范围'}</span>
                                <span className="hidden font-semibold text-accent-text opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 sm:inline">
                                  {episodes.length > 0 ? '进入工作台' : '生成并进入'}
                                </span>
                              </div>
                            </div>
                            <p className="mt-2 line-clamp-2 text-xs leading-5 text-text-2">{episode.hook}</p>
                          </button>
                        ))}
                      </div>
                    ) : planTab === 'characters' ? (
                      <div className="grid gap-3 md:grid-cols-2">
                        {adaptationPlan.character_bible.map((character) => (
                          <CharacterBibleCard key={character.name} character={character} compact onOpen={setSelectedPlanCharacter} />
                        ))}
                      </div>
                    ) : (
                      <div className="grid gap-3 md:grid-cols-2">
                        {adaptationPlan.scene_bible.map((scene) => (
                          <SceneBibleCard key={`${scene.name}-${scene.location}`} scene={scene} compact />
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
              </div>
            </section>
            ) : null}
          </div>
        ) : null}

        {!readOnly && hasEpisodes ? (
          <div className="mt-5 flex flex-col gap-2">
            <div className="flex items-center gap-2 text-base font-semibold text-text-0">
              <span className="inline-flex size-7 items-center justify-center rounded-full bg-accent text-xs font-black text-on-accent">03</span>
              <LayoutGrid size={16} />
              分集制作
            </div>
            <p className="text-sm leading-6 text-text-2">
              改编规划确认后会生成分集；每个分集卡片进入现有单集工作台继续剧本、分镜和视频制作。
            </p>
          </div>
        ) : null}

        {readOnly || hasEpisodes ? (
        <>
        <div className="mt-4 flex w-full max-w-[720px] rounded-[9px] border border-border bg-bg-2 p-1">
          {tabs.map(({ key, label, icon: Icon, count }) => (
            <button
              key={key}
              type="button"
              aria-label={label}
              onClick={() => setActiveTab(key)}
              className={`flex h-8 min-w-0 flex-1 items-center justify-center gap-2 rounded-[8px] px-3 text-sm font-bold transition-colors ${
                activeTab === key ? 'bg-bg-0 text-text-0 shadow-shadow-xs' : 'text-text-1 hover:bg-bg-hover'
              }`}
            >
              <Icon size={15} />
              <span className="truncate">{label}</span>
              {count > 0 ? (
                <span className="inline-flex size-5 items-center justify-center rounded-full bg-accent text-xs text-on-accent">
                  {count}
                </span>
              ) : null}
            </button>
          ))}
        </div>

        {activeTab === 'episodes' ? (
          <div className="mt-5">
            {episodes.length === 0 ? (
              readOnly ? (
                <div className="flex min-h-[220px] flex-col items-center justify-center rounded-[12px] border border-dashed border-border-strong bg-bg-0 px-6 py-12 text-center">
                  <FileText size={40} className="text-text-3" strokeWidth={1.5} />
                  <p className="mt-4 max-w-md text-sm leading-7 text-text-2">暂无公开分集内容，或作者尚未发布。登录后可创建自己的项目。</p>
                  <Button type="button" variant="outline" className="mt-6 h-10 rounded-[11px]" onClick={openLoginNextHere}>
                    <LogIn size={15} />
                    登录
                  </Button>
                </div>
              ) : (
              <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(360px,1fr)]">
                <div className="flex min-h-[308px] flex-col items-center justify-center rounded-[12px] border border-dashed border-accent-glow bg-accent-bg px-6 py-10 text-center">
                  <FileUp size={54} className="text-accent" strokeWidth={1.9} />
                  <h3 className="mt-6 font-body text-[22px] font-black tracking-normal text-text-0">快速按标记分集</h3>
                  <p className="mt-3 text-sm text-text-2">适合已经写好“第1集 / 第2集”标记的剧本；整本小说请先走上方源稿和改编规划。</p>
                  <Button
                    className="mt-7 h-10 rounded-[11px] px-5 text-sm font-bold"
                    onClick={() => {
                      setSplitContent('')
                      setSplitDialog(true)
                    }}
                  >
                    <FileUp size={15} />
                    开始分集
                  </Button>
                </div>

                <button
                  type="button"
                  onClick={() => { setNewTitle(''); setAddDialog(true) }}
                  className="flex min-h-[308px] flex-col items-center justify-center rounded-[12px] border border-dashed border-border-strong bg-bg-0 px-6 py-10 text-center transition-colors hover:border-accent hover:bg-bg-hover"
                >
                  <Plus size={44} className="text-text-3" strokeWidth={1.7} />
                  <h3 className="mt-5 font-body text-base font-black tracking-normal text-text-0">手动新增一集</h3>
                  <p className="mt-3 text-sm text-text-2">从零开始创作你的短剧故事</p>
                </button>
              </div>
              )
            ) : (
              <div className="space-y-4">
                {!readOnly && episodes.length === 1 && (episodes[0]?.content || '').trim().length > 1200 ? (
                  <div className="flex flex-col gap-3 rounded-[14px] border border-accent-glow bg-accent-bg px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <div className="text-sm font-semibold text-text-0">当前只有 1 集，可以重新按标记分集</div>
                      <p className="mt-1 text-sm leading-6 text-text-2">
                        系统会读取当前第 1 集的原始内容，按“第1集”“第一章”等明确标记重新拆成多集。
                      </p>
                    </div>
                    <Button
                      className="h-9 rounded-[var(--radius-sm)] px-4"
                      disabled={splitting}
                      onClick={() => {
                        setSplitContent('')
                        void splitEpisodes()
                      }}
                    >
                      {splitting ? '分集中...' : '重新分集'}
                    </Button>
                  </div>
                ) : null}

              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
                {episodes.map((ep: Episode, i: number) => {
                  const preview = episodePreviewText(ep)
                  return (
                  <article
                    key={ep.id}
                    className={`group flex min-h-[200px] flex-col rounded-[10px] border border-border bg-bg-0 p-5 shadow-shadow-xs transition-colors ${
                      readOnly
                        ? preview
                          ? 'cursor-pointer hover:border-accent hover:bg-bg-hover'
                          : ''
                        : 'cursor-pointer hover:border-accent hover:bg-bg-hover'
                    }`}
                    style={{ animationDelay: `${i * 0.05}s` }}
                    onClick={() => {
                      if (readOnly) {
                        if (preview) setPreviewScriptEpisode(ep)
                        else toast.info('本集暂无公开正文')
                        return
                      }
                      router.push(`/drama/${drama.id}/episode/${ep.episode_number}`)
                    }}
                  >
                    <div className="w-fit rounded-[4px] border border-accent-glow bg-accent-bg px-3 py-1.5 text-sm font-medium text-accent-text">
                      第 {ep.episode_number} 集
                    </div>
                    <h3 className="mt-4 font-body text-lg font-black tracking-normal text-text-0">
                      {ep.title || `第${ep.episode_number}集`}
                    </h3>
                    <div className="mt-3 flex items-center gap-1.5 text-sm text-text-2">
                      <Clock3 size={14} />
                      {formatEpisodeDuration(ep.duration)}
                    </div>

                    <div className="mt-auto border-t border-border pt-3">
                      {ep.video_url ? (
                        <Button
                          variant="outline"
                          size="sm"
                          className="mb-2 h-8 rounded-[8px]"
                          onClick={(event) => {
                            event.stopPropagation()
                            setPreviewVideoUrl(staticUrl(ep.video_url))
                            setPreviewVideoTitle(ep.title || `第 ${ep.episode_number} 集`)
                          }}
                        >
                          预览视频
                        </Button>
                      ) : null}
                      {readOnly ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="ml-auto flex h-8 rounded-[7px] px-4 text-sm font-bold"
                          disabled={!preview}
                          onClick={(event) => {
                            event.stopPropagation()
                            if (preview) setPreviewScriptEpisode(ep)
                            else toast.info('本集暂无公开正文')
                          }}
                        >
                          <FileText size={14} />
                          {preview ? '预览原文' : '暂无正文'}
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          className="ml-auto flex h-8 rounded-[7px] px-4 text-sm font-bold"
                          onClick={(event) => {
                            event.stopPropagation()
                            router.push(`/drama/${drama.id}/episode/${ep.episode_number}`)
                          }}
                        >
                          <Play size={14} fill="currentColor" strokeWidth={0} />
                          进入制作
                        </Button>
                      )}
                    </div>
                  </article>
                  )
                })}

                {!readOnly ? (
                <button
                  type="button"
                  onClick={() => { setNewTitle(''); setAddDialog(true) }}
                  className="flex min-h-[200px] flex-col items-center justify-center rounded-[10px] border border-dashed border-border-strong bg-bg-0 p-5 text-center transition-colors hover:border-accent hover:bg-bg-hover"
                >
                  <Plus size={42} className="text-text-3" strokeWidth={1.7} />
                  <span className="mt-5 font-body text-base font-black tracking-normal text-text-0">新增一集</span>
                  <span className="mt-3 text-sm text-text-2">继续创作你的短剧故事</span>
                </button>
                ) : null}
              </div>
              </div>
            )}
          </div>
        ) : activeTab === 'characters' ? (
          <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {(drama.characters || []).map((character) => (
              <article key={character.id} className="min-h-[150px] rounded-[10px] border border-border bg-bg-0 p-5 shadow-shadow-xs">
                <div className="flex items-center gap-3">
                  <div className="flex size-11 items-center justify-center rounded-[8px] bg-accent-bg text-accent">
                    <UserRound size={19} />
                  </div>
                  <div className="min-w-0">
                    <h3 className="truncate font-body text-base font-black tracking-normal text-text-0">{character.name}</h3>
                    <p className="text-sm text-text-2">{character.role || '角色'}</p>
                  </div>
                </div>
                <p className="mt-4 line-clamp-3 text-sm leading-6 text-text-2">
                  {character.description || character.appearance || character.personality || '暂无角色描述'}
                </p>
              </article>
            ))}
            {(!drama.characters || drama.characters.length === 0) ? (
              <div className="col-span-full flex min-h-[220px] flex-col items-center justify-center rounded-[10px] border border-dashed border-border-strong bg-bg-0 text-center">
                <UserRound size={36} className="text-text-3" />
                <p className="mt-4 text-sm text-text-2">暂无角色，进入分集制作后可从剧本提取。</p>
              </div>
            ) : null}
          </div>
        ) : activeTab === 'source' ? (
          <div className="mt-5 rounded-[14px] border border-border bg-bg-0 p-5 shadow-shadow-xs">
            {novelSource ? (
              <>
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-base font-semibold text-text-0">
                      <BookOpen size={16} />
                      原稿
                    </div>
                    <h3 className="mt-3 truncate font-body text-xl font-black tracking-normal text-text-0">
                      {novelSource.title || drama.title}
                    </h3>
                    <div className="mt-2 flex flex-wrap gap-2 text-xs text-text-2">
                      <span className="rounded-full border border-border bg-bg-2 px-3 py-1.5">{formatCount(novelSource.word_count)} 字</span>
                      <span className="rounded-full border border-border bg-bg-2 px-3 py-1.5">{novelSource.chapter_count || 1} 章</span>
                      <span className="rounded-full border border-border bg-bg-2 px-3 py-1.5">导入 {novelSource.imported_at ? new Date(novelSource.imported_at).toLocaleDateString() : '未记录'}</span>
                    </div>
                  </div>
                  {!readOnly ? (
                    <div className="flex shrink-0 flex-wrap gap-2">
                      <Button type="button" variant="outline" size="sm" className="h-9 rounded-[9px]" onClick={() => openSourceDialog('view')}>
                        <Eye size={14} />
                        查看原稿
                      </Button>
                      <Button type="button" variant="ghost" size="sm" className="h-9 rounded-[9px]" onClick={() => openSourceDialog('edit')}>
                        <RefreshCw size={14} />
                        重新导入
                      </Button>
                    </div>
                  ) : null}
                </div>
                {hasSourceIssue ? (
                  <div role="alert" className="mt-4 rounded-[12px] border border-warning/30 bg-warning-bg px-4 py-3">
                    <div className="flex items-start gap-2">
                      <AlertTriangle size={16} className="mt-0.5 shrink-0 text-warning" />
                      <div>
                        <div className="text-sm font-semibold text-warning">当前原稿内容异常</div>
                        <p className="mt-1 text-sm leading-6 text-text-2">{novelSourceHealth.message}</p>
                      </div>
                    </div>
                  </div>
                ) : null}
                <p className="mt-4 line-clamp-5 text-sm leading-7 text-text-2">
                  {novelSource.summary || novelSource.content.slice(0, 320)}
                </p>
              </>
            ) : (
              <div className="flex min-h-[220px] flex-col items-center justify-center text-center">
                <BookOpen size={36} className="text-text-3" />
                <p className="mt-4 text-sm text-text-2">暂无原稿。</p>
              </div>
            )}
          </div>
        ) : activeTab === 'plan' ? (
          <div className="mt-5 rounded-[14px] border border-border bg-bg-0 p-5 shadow-shadow-xs">
            {adaptationPlan ? (
              <>
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div>
                    <div className="flex items-center gap-2 text-base font-semibold text-text-0">
                      <Wand2 size={16} />
                      方案草稿
                    </div>
                    <p className="mt-2 text-sm leading-6 text-text-2">
                      目标：{adaptationPlan.target_episode_count} 集 · 每集 {adaptationPlan.episode_duration}
                    </p>
                  </div>
                  {!readOnly ? (
                    hasSourceIssue ? (
                      <Button type="button" variant="outline" size="sm" className="h-9 rounded-[9px]" onClick={() => openSourceDialog('edit')}>
                        <RefreshCw size={14} />
                        修复源稿
                      </Button>
                    ) : (
                      <Button type="button" variant="outline" size="sm" className="h-9 rounded-[9px]" disabled={planGenerating} onClick={generateAdaptationPlan}>
                        {planGenerating ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                        重新生成草稿
                      </Button>
                    )
                  ) : null}
                </div>
                {hasSourceIssue ? (
                  <div role="alert" className="mt-4 rounded-[12px] border border-warning/30 bg-warning-bg px-4 py-3">
                    <div className="text-sm font-semibold text-warning">当前方案基于异常源稿生成</div>
                    <p className="mt-1 text-sm leading-6 text-text-2">
                      {novelSourceHealth.message} 请先修复原稿，再重新生成可用草稿。
                    </p>
                  </div>
                ) : null}
                <div className="mt-4 rounded-[12px] border border-accent-glow bg-accent-bg p-4">
                  <div className="text-sm font-semibold text-text-0">{adaptationPlan.logline || '故事主线'}</div>
                  <p className="mt-2 text-sm leading-6 text-text-2">{adaptationPlan.main_plot}</p>
                </div>
                <div className="mt-4 flex rounded-[9px] border border-border bg-bg-2 p-1">
                  {[
                    { key: 'episodes' as const, label: '分集大纲', count: adaptationPlan.episode_outlines.length },
                    { key: 'characters' as const, label: '角色圣经', count: adaptationPlan.character_bible.length },
                    { key: 'scenes' as const, label: '场景圣经', count: adaptationPlan.scene_bible.length },
                  ].map((item) => (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => setPlanTab(item.key)}
                      className={`flex h-8 min-w-0 flex-1 items-center justify-center gap-2 rounded-[8px] px-3 text-sm font-bold transition-colors ${
                        planTab === item.key ? 'bg-bg-0 text-text-0 shadow-shadow-xs' : 'text-text-1 hover:bg-bg-hover'
                      }`}
                    >
                      <span className="truncate">{item.label}</span>
                      <span className="inline-flex size-5 items-center justify-center rounded-full bg-accent text-xs text-on-accent">{item.count}</span>
                    </button>
                  ))}
                </div>
                <div className="mt-4 max-h-[360px] overflow-y-auto rounded-[12px] border border-border bg-bg-2 p-3">
                  {planTab === 'episodes' ? (
                    <div className="space-y-3">
                      {adaptationPlan.episode_outlines.map((episode) => (
                        <button
                          key={episode.episode_number}
                          type="button"
                          className="group w-full rounded-[10px] border border-border bg-bg-0 p-3 text-left transition-[background,border-color,box-shadow] hover:border-accent hover:bg-bg-hover hover:shadow-shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/35 disabled:cursor-wait disabled:opacity-70"
                          disabled={episodesGenerating}
                          onClick={() => { void openPlanEpisode(episode.episode_number) }}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0 truncate text-sm font-semibold text-text-0">{episode.title}</div>
                            <div className="flex shrink-0 items-center gap-2 text-xs">
                              <span className="text-text-3">{episode.source_range || '待定范围'}</span>
                              <span className="hidden font-semibold text-accent-text opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 sm:inline">
                                {episodes.length > 0 ? '进入工作台' : '生成并进入'}
                              </span>
                            </div>
                          </div>
                          <p className="mt-2 text-xs leading-5 text-text-2">{episode.hook}</p>
                        </button>
                      ))}
                    </div>
                  ) : planTab === 'characters' ? (
                    <div className="grid gap-3 md:grid-cols-2">
                      {adaptationPlan.character_bible.map((character) => (
                        <CharacterBibleCard key={character.name} character={character} onOpen={setSelectedPlanCharacter} />
                      ))}
                    </div>
                  ) : (
                    <div className="grid gap-3 md:grid-cols-2">
                      {adaptationPlan.scene_bible.map((scene) => (
                        <SceneBibleCard key={`${scene.name}-${scene.location}`} scene={scene} />
                      ))}
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="flex min-h-[220px] flex-col items-center justify-center text-center">
                <Wand2 size={36} className="text-text-3" />
                <p className="mt-4 text-sm text-text-2">暂无方案草稿。</p>
              </div>
            )}
          </div>
        ) : (
          <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {(drama.scenes || []).map((scene) => (
              <article key={scene.id} className="min-h-[150px] rounded-[10px] border border-border bg-bg-0 p-5 shadow-shadow-xs">
                <div className="flex items-center gap-3">
                  <div className="flex size-11 items-center justify-center rounded-[8px] bg-accent-bg text-accent">
                    <Mountain size={19} />
                  </div>
                  <div className="min-w-0">
                    <h3 className="truncate font-body text-base font-black tracking-normal text-text-0">{scene.location || '未命名场景'}</h3>
                    <p className="text-sm text-text-2">{scene.time || '场景'}</p>
                  </div>
                </div>
                <p className="mt-4 line-clamp-3 text-sm leading-6 text-text-2">
                  {scene.prompt || '暂无场景描述'}
                </p>
              </article>
            ))}
            {(!drama.scenes || drama.scenes.length === 0) ? (
              <div className="col-span-full flex min-h-[220px] flex-col items-center justify-center rounded-[10px] border border-dashed border-border-strong bg-bg-0 text-center">
                <Mountain size={36} className="text-text-3" />
                <p className="mt-4 text-sm text-text-2">暂无场景，进入分集制作后可从剧本提取。</p>
              </div>
            ) : null}
          </div>
        )}
        </>
        ) : null}

      </section>

      {/* Add Episode Dialog */}
      </div>

      <Dialog open={sourcePickerOpen} onOpenChange={setSourcePickerOpen}>
        <DialogContent className="flex max-h-[min(88dvh,760px)] w-[calc(100vw-2rem)] max-w-[860px] flex-col gap-0 overflow-hidden rounded-[22px] border-border bg-bg-surface p-0 shadow-shadow-elevated sm:max-w-[860px]">
          <DialogTitle className="sr-only">从小说模块引入</DialogTitle>
          <DialogDescription className="sr-only">
            选择已有小说作品并导入当前短剧项目，导入后会替换现有源稿并继续用于生成方案草稿。
          </DialogDescription>
          <DialogHeaderBar className="border-b-0 bg-transparent px-7 pb-3 pt-7 sm:px-8 sm:pt-8">
            <div className="flex items-start gap-4 pr-12">
              <div className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-[var(--radius-sm)] border border-accent-glow bg-accent-bg text-accent">
                <BookOpen size={20} />
              </div>
              <div className="min-w-0">
                <div className="text-[22px] font-bold leading-tight tracking-[-0.018em] text-text-0">
                  从小说模块引入
                </div>
                <p className="mt-2 text-sm leading-6 text-text-2">
                  选择一个已有小说作品，系统会导出全文并写入当前项目的小说源稿。后续会从这里继续生成方案草稿。
                </p>
              </div>
            </div>
          </DialogHeaderBar>

          <DialogMain className="min-h-0 flex-1 gap-4 overflow-hidden px-7 pb-5 pt-2 sm:px-8">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <Input
                value={writingSourceQuery}
                onChange={(event) => setWritingSourceQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void loadWritingSources(writingSourceQuery)
                }}
                placeholder="搜索小说标题或梗概"
                className="h-10"
              />
              <Button
                type="button"
                variant="outline"
                className="h-10 shrink-0 rounded-[9px] px-4"
                disabled={writingSourceLoading}
                onClick={() => void loadWritingSources(writingSourceQuery)}
              >
                {writingSourceLoading ? <Loader2 size={14} className="animate-spin" /> : null}
                搜索
              </Button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto rounded-[14px] border border-border bg-bg-2 p-3">
              {writingSourceLoading ? (
                <div className="flex min-h-[280px] items-center justify-center text-text-3">
                  <Loader2 size={28} className="animate-spin" />
                </div>
              ) : writingSources.length === 0 ? (
                <div className="flex min-h-[280px] flex-col items-center justify-center px-6 text-center">
                  <BookOpen size={38} className="text-text-3" strokeWidth={1.7} />
                  <h3 className="mt-4 font-body text-base font-black tracking-normal text-text-0">暂无可引入小说</h3>
                  <p className="mt-2 max-w-md text-sm leading-6 text-text-2">
                    先去小说模块新建或完善一部小说，再回到这里引入为短剧源稿。
                  </p>
                  <Button
                    type="button"
                    className="mt-5 h-9 rounded-[9px] px-4"
                    onClick={() => router.push('/writing')}
                  >
                    <Plus size={14} />
                    去小说模块
                  </Button>
                </div>
              ) : (
                <div className="grid gap-3">
                  {writingSources.map((item) => {
                    const importing = writingSourceImportingId === item.id
                    return (
                      <button
                        key={item.id}
                        type="button"
                        className="group flex min-h-[112px] w-full items-start gap-4 rounded-[12px] border border-border bg-bg-0 p-4 text-left shadow-shadow-xs transition-colors hover:border-accent hover:bg-bg-hover disabled:cursor-not-allowed disabled:opacity-70"
                        disabled={writingSourceImportingId != null}
                        onClick={() => void importWritingSource(item)}
                      >
                        <div className="flex size-10 shrink-0 items-center justify-center rounded-[10px] bg-accent-bg text-accent">
                          {importing ? <Loader2 size={18} className="animate-spin" /> : <FileText size={18} />}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="line-clamp-1 font-body text-base font-black tracking-normal text-text-0 group-hover:text-accent">
                              {item.title}
                            </h3>
                            <span className="rounded-full border border-border bg-bg-2 px-2.5 py-1 text-xs text-text-2">
                              {item.document_count} 文档
                            </span>
                          </div>
                          <p className="mt-2 line-clamp-2 text-sm leading-6 text-text-2">
                            {item.synopsis || '暂无梗概，导入时会读取作品导出的完整 Markdown。'}
                          </p>
                          <div className="mt-3 text-xs text-text-3">
                            更新 {item.updated_at ? new Date(item.updated_at).toLocaleDateString() : '未知'}
                          </div>
                        </div>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          </DialogMain>

          <DialogActions className="items-center justify-between gap-3 border-t border-border bg-bg-0/70 px-7 py-5 sm:flex-row sm:px-8">
            <p className="text-xs leading-5 text-text-3">
              引入会替换当前小说源稿，并清空旧改编规划；已有分集不会被自动删除。
            </p>
            <div className="flex shrink-0 justify-end gap-3">
              <Button
                type="button"
                variant="outline"
                className="h-9 rounded-[var(--radius-sm)] px-4"
                onClick={() => router.push('/writing')}
              >
                去小说模块
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="h-9 rounded-[var(--radius-sm)] px-4"
                onClick={() => setSourcePickerOpen(false)}
                disabled={writingSourceImportingId != null}
              >
                取消
              </Button>
            </div>
          </DialogActions>
        </DialogContent>
      </Dialog>

      <CharacterBibleDialog character={selectedPlanCharacter} onClose={() => setSelectedPlanCharacter(null)} />

      <Dialog open={sourceDialogOpen} onOpenChange={setSourceDialogOpen}>
        <DialogContent
          aria-describedby="novel-source-dialog-description"
          className="flex max-h-[min(88dvh,760px)] w-[min(860px,calc(100vw-2rem))] max-w-[860px] flex-col gap-0 overflow-hidden rounded-[22px] border-border bg-bg-surface p-0 shadow-shadow-elevated sm:max-w-[860px]"
        >
          <DialogHeaderBar className="border-b border-border/70 bg-bg-0/90 px-6 py-5 sm:px-7 sm:py-6">
            <div className="flex items-start gap-3.5 pr-11">
              <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-[var(--radius-sm)] border border-accent-glow bg-accent-bg text-accent">
                <BookOpen size={18} />
              </div>
              <div className="min-w-0">
                <DialogTitle className="font-body text-xl font-semibold leading-tight tracking-[-0.012em] text-text-0">
                  {sourceDialogMode === 'view' ? '查看小说源稿' : novelSource ? '重新导入小说源稿' : '导入小说源稿'}
                </DialogTitle>
                <DialogDescription id="novel-source-dialog-description" className="mt-1.5 max-w-[64ch] text-sm leading-6 text-text-2">
                  第一阶段先支持粘贴全文。保存后会写入项目 metadata，并统计字数和章节，供改编规划使用。
                </DialogDescription>
              </div>
            </div>
          </DialogHeaderBar>

          <DialogMain className="min-h-0 flex-1 gap-5 overflow-y-auto px-6 py-5 sm:px-7">
            {sourceDialogMode === 'edit' && adaptationPlan ? (
              <div className="flex gap-3 rounded-[14px] border border-accent-glow bg-accent-bg px-4 py-3">
                <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-bg-surface/70 text-accent">
                  <RefreshCw size={14} />
                </div>
                <div className="min-w-0">
                  <div className="text-xs font-semibold tracking-[0.02em] text-accent-text">重新导入提醒</div>
                  <p className="mt-1 text-[13px] leading-6 text-text-2">
                    保存新的小说源稿后，当前改编规划会被置为失效并清空；已有分集不会被自动删除。
                  </p>
                </div>
              </div>
            ) : null}
            {sourceDialogHasBlockingIssue ? (
              <div role="alert" className="flex gap-3 rounded-[14px] border border-warning/30 bg-warning-bg px-4 py-3">
                <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-bg-surface/70 text-warning">
                  <AlertTriangle size={14} />
                </div>
                <div className="min-w-0">
                  <div className="text-xs font-semibold tracking-[0.02em] text-warning">源稿内容异常</div>
                  <p id="novel-source-content-error" className="mt-1 text-[13px] leading-6 text-text-2">
                    {sourceDialogHealth.message}
                  </p>
                </div>
              </div>
            ) : null}

            <div className="rounded-[16px] border border-border bg-bg-0 p-4 shadow-shadow-xs">
              <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                <label className="flex min-w-0 flex-col gap-2">
                  <span className="text-xs font-semibold uppercase tracking-[0.08em] text-text-3">源稿标题</span>
                  <Input
                    value={sourceTitleDraft}
                    onChange={(event) => setSourceTitleDraft(event.target.value)}
                    placeholder="例如：时光邮局"
                    className="h-10 text-sm"
                    disabled={sourceDialogMode === 'view'}
                  />
                </label>
                <div className="flex flex-wrap gap-2 text-xs text-text-2 sm:justify-end">
                  <span className="inline-flex h-9 items-center gap-1.5 rounded-full border border-border bg-bg-2 px-3">
                    <FileText size={13} />
                    {formatCount(sourceDraftWordCount)} 字
                  </span>
                  <span className="inline-flex h-9 items-center gap-1.5 rounded-full border border-border bg-bg-2 px-3">
                    <LayoutGrid size={13} />
                    {sourceDraftChapterCount} 章
                  </span>
                </div>
              </div>
              <p className="mt-2 text-xs leading-5 text-text-3">标题仅用于识别源稿，不影响已创建分集。</p>
            </div>

            <div className="flex min-h-0 flex-1 flex-col gap-2">
              <div className="flex items-center justify-between gap-3">
                <label htmlFor="novel-source-content" className="text-xs font-semibold uppercase tracking-[0.08em] text-text-3">
                  源稿正文
                </label>
                <span className="shrink-0 text-xs text-text-3">{sourceContentDraft.length.toLocaleString()} 字符</span>
              </div>
              <textarea
                id="novel-source-content"
                value={sourceContentDraft}
                onChange={(event) => setSourceContentDraft(event.target.value)}
                placeholder="请粘贴整本小说全文..."
                readOnly={sourceDialogMode === 'view'}
                aria-invalid={sourceDialogHasBlockingIssue ? true : undefined}
                aria-describedby={sourceDialogHasBlockingIssue ? 'novel-source-content-help novel-source-content-error' : 'novel-source-content-help'}
                className="h-[clamp(260px,34dvh,340px)] min-h-[260px] w-full shrink-0 resize-none rounded-[18px] border border-border bg-bg-input px-4 py-3.5 text-sm leading-7 text-text-0 shadow-inset outline-none transition-[border-color,box-shadow] placeholder:text-text-3 read-only:bg-bg-2 focus:border-border-focus focus:ring-[3px] focus:ring-accent-glow"
              />
              <p id="novel-source-content-help" className="text-xs leading-5 text-text-3">
                建议粘贴完整正文；系统会按章节标记统计章节，没有章节标记时会按全文处理。
              </p>
            </div>
          </DialogMain>

          <DialogActions className="items-start justify-between gap-4 border-t border-border bg-bg-0/90 px-6 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-7">
            <p className="max-w-[52ch] text-xs leading-5 text-text-3">
              源稿用于项目级改编规划；快速按标记分集仍保留在分集列表空状态中。
            </p>
            <div className="flex w-full shrink-0 flex-col-reverse gap-2 sm:w-auto sm:flex-row sm:justify-end">
              <Button type="button" variant="ghost" className="h-10 w-full rounded-[var(--radius-sm)] px-4 sm:w-auto" onClick={() => setSourceDialogOpen(false)} disabled={sourceSaving}>
                {sourceDialogMode === 'view' ? '关闭' : '取消'}
              </Button>
              {sourceDialogMode === 'view' && hasSourceIssue ? (
                <Button
                  type="button"
                  className="h-10 w-full rounded-[var(--radius-sm)] px-5 sm:w-auto"
                  onClick={() => setSourceDialogMode('edit')}
                >
                  <RefreshCw size={14} />
                  修复源稿
                </Button>
              ) : null}
              {sourceDialogMode === 'edit' ? (
                <Button
                  type="button"
                  className="h-10 w-full rounded-[var(--radius-sm)] px-5 sm:w-auto"
                  disabled={sourceSaving || !sourceContentDraft.trim() || sourceDialogHealth.kind !== 'valid'}
                  onClick={saveNovelSource}
                >
                  {sourceSaving ? <Loader2 size={14} className="animate-spin" /> : <FileUp size={14} />}
                  {sourceSaving ? '保存中...' : '保存源稿'}
                </Button>
              ) : null}
            </div>
          </DialogActions>
        </DialogContent>
      </Dialog>

      <Dialog open={projectDefaultsDialogOpen} onOpenChange={setProjectDefaultsDialogOpen}>
        <DialogContent layout="panel" size="large" className="animate-scale-in">
          <DialogDescription className="sr-only">
            配置当前项目默认使用的图片、视频和配音模型，后续制作流程会优先继承这些设定。
          </DialogDescription>
          <DialogHeaderBar className="border-0 bg-transparent">
            <div className="flex gap-3.5">
              <div
                className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-[var(--radius-md)] border border-accent-glow bg-accent-bg text-accent shadow-shadow-xs"
                aria-hidden
              >
                <Settings2 className="size-5" strokeWidth={2} />
              </div>
              <div className="min-w-0 flex-1 pr-7">
                <DialogTitle className="font-display text-xl font-bold tracking-tight text-text-0 sm:text-[22px]">
                  项目默认设定
                </DialogTitle>
                <p className="mt-2 text-sm leading-6 text-text-2">
                  固定本项目常用的图片、视频和配音模型；角色、主角和音色由方案草稿与后续制作流程生成。
                </p>
              </div>
            </div>
          </DialogHeaderBar>

          <DialogMain className="min-h-0 flex-1 overflow-y-auto border-t border-border/70">
            {missingConfigHints.length > 0 ? (
              <div role="alert" className="mb-4 rounded-[12px] border border-warning/30 bg-warning-bg px-4 py-3">
                <div className="text-sm font-semibold text-warning">仍缺少可用 AI 配置</div>
                <p className="mt-1 text-sm leading-6 text-text-2">
                  {missingConfigHints.join('、')}暂无启用项；相关生成按钮会提示先到设置中启用配置。
                </p>
              </div>
            ) : null}
            <div className="grid gap-4 xl:grid-cols-3">
              <label className="flex min-w-0 flex-col gap-2">
                <span className="text-xs font-medium text-text-2">默认图片模型</span>
                <BaseSelect
                  className="[&_button]:h-11 [&_button]:px-3.5 [&_button]:text-sm"
                  value={projectDefaults.image_config_id}
                  onValueChange={(v) => setProjectDefaults((prev) => ({ ...prev, image_config_id: String(v) }))}
                  options={imageConfigOptions}
                  placeholder="选择图片模型"
                />
              </label>
              <label className="flex min-w-0 flex-col gap-2">
                <span className="text-xs font-medium text-text-2">默认视频模型</span>
                <BaseSelect
                  className="[&_button]:h-11 [&_button]:px-3.5 [&_button]:text-sm"
                  value={projectDefaults.video_config_id}
                  onValueChange={(v) => setProjectDefaults((prev) => ({ ...prev, video_config_id: String(v) }))}
                  options={videoConfigOptions}
                  placeholder="选择视频模型"
                />
              </label>
              <label className="flex min-w-0 flex-col gap-2">
                <span className="text-xs font-medium text-text-2">默认配音模型</span>
                <BaseSelect
                  className="[&_button]:h-11 [&_button]:px-3.5 [&_button]:text-sm"
                  value={projectDefaults.audio_config_id}
                  onValueChange={(v) => setProjectDefaults((prev) => ({ ...prev, audio_config_id: String(v) }))}
                  options={audioConfigOptions}
                  placeholder="选择配音模型"
                />
              </label>
            </div>

          </DialogMain>

          <DialogActions>
            <Button
              type="button"
              variant="ghost"
              className="h-10 w-full sm:w-auto sm:min-w-[88px]"
              onClick={() => setProjectDefaultsDialogOpen(false)}
              disabled={defaultsSaving}
            >
              取消
            </Button>
            <Button
              type="button"
              className="h-10 w-full rounded-full px-6 sm:w-auto sm:min-w-[132px]"
              disabled={defaultsSaving}
              onClick={async () => {
                await saveProjectDefaults()
                setProjectDefaultsDialogOpen(false)
              }}
            >
              {defaultsSaving ? <Loader2 size={15} className="animate-spin" /> : <Settings2 size={15} />}
              保存设定
            </Button>
          </DialogActions>
        </DialogContent>
      </Dialog>

      <Dialog open={splitDialog} onOpenChange={setSplitDialog}>
        <DialogContent className="flex max-h-[min(90dvh,820px)] w-[calc(100vw-2rem)] max-w-[920px] flex-col gap-0 overflow-hidden rounded-[22px] border-border bg-bg-surface p-0 shadow-shadow-elevated sm:max-w-[920px] lg:w-[min(920px,calc(100vw-2rem))]">
          <DialogTitle className="sr-only">快速按标记分集</DialogTitle>
          <DialogDescription className="sr-only">
            粘贴带有集数或章节标记的剧本文本，系统会按标记自动拆分并写入各集原始内容。
          </DialogDescription>
          <DialogHeaderBar className="border-b-0 bg-transparent px-7 pb-3 pt-7 sm:px-8 sm:pt-8">
            <div className="flex items-start gap-4 pr-12">
              <div className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-[var(--radius-sm)] border border-accent-glow bg-accent-bg text-accent">
                <FileUp size={20} />
              </div>
              <div className="min-w-0">
                <div className="text-[22px] font-bold leading-tight tracking-[-0.018em] text-text-0">快速按标记分集</div>
                <p className="mt-2 text-sm leading-6 text-text-2">
                  粘贴已带集数或章节标记的剧本，系统会按“第1集”“第一集”“第1章”“第一章”等明确标记拆分，并保存到每集原始内容。
                </p>
              </div>
            </div>
          </DialogHeaderBar>

          <DialogMain className="min-h-0 flex-1 gap-4 overflow-hidden px-7 pb-5 pt-2 sm:px-8">
            <div className="rounded-[16px] border border-accent-glow bg-accent-bg px-4 py-3">
              <div className="text-xs font-semibold text-accent-text">推荐格式</div>
              <p className="mt-1 text-[13px] leading-6 text-text-2">
                在剧本中使用“第1集”“第一集”“第1章”“第一章”等明确标记；未识别到标记时不会自动按剧情或长度拆分。
              </p>
            </div>

            <div className="flex items-center justify-between gap-3">
              <div className="flex h-9 items-center gap-2 rounded-full border border-border bg-bg-2 px-4 text-sm font-semibold text-text-1">
                <FileText size={15} />
                文本输入
              </div>
              <span className="text-xs text-text-3">将写入每集原始内容</span>
            </div>

            <label className="relative block">
              <textarea
                value={splitContent}
                onChange={(event) => setSplitContent(event.target.value)}
                placeholder="请输入或粘贴剧本内容..."
                className="h-[clamp(260px,38dvh,330px)] w-full resize-none rounded-[18px] border border-border bg-bg-input px-4 py-3.5 text-sm leading-7 text-text-0 shadow-inset outline-none transition-[border-color,box-shadow] placeholder:text-text-3 focus:border-border-focus focus:ring-[3px] focus:ring-accent-glow"
              />
              <span className="absolute bottom-3 right-4 text-xs text-text-3">{splitContent.length}</span>
            </label>
          </DialogMain>

          <DialogActions className="items-center justify-between gap-3 border-t border-border bg-bg-0/70 px-7 py-5 sm:flex-row sm:px-8">
            <p className="text-xs leading-5 text-text-3">
              创建后可在分集卡片进入制作页继续改写剧本。
            </p>
            <div className="flex shrink-0 justify-end gap-3">
              <Button type="button" variant="ghost" className="h-9 rounded-[var(--radius-sm)] px-4" onClick={() => setSplitDialog(false)} disabled={splitting}>
                取消
              </Button>
              <Button
                type="button"
                className="h-9 rounded-[var(--radius-sm)] px-5"
                disabled={splitting || !splitContent.trim()}
                onClick={splitEpisodes}
              >
                {splitting ? '分集中...' : '开始分集'}
              </Button>
            </div>
          </DialogActions>
        </DialogContent>
      </Dialog>

      <Dialog open={addDialog} onOpenChange={setAddDialog}>
        <DialogContent className="flex max-h-[min(760px,calc(100dvh-2rem))] w-[min(620px,calc(100%-2rem))] max-w-[620px] flex-col gap-0 overflow-hidden rounded-[28px] border-border/70 bg-bg-surface p-0 shadow-shadow-elevated sm:p-0">
          <DialogTitle className="sr-only">创建新集</DialogTitle>
          <DialogDescription className="sr-only">
            为当前短剧项目创建新的一集，并可在创建后直接进入单集制作页面。
          </DialogDescription>
          <DialogHeaderBar className="border-b-0 bg-transparent px-0 sm:pb-3">
            <div className="text-[1.55rem] font-semibold tracking-[-0.018em] text-text-0">添加新集</div>
            <p className="mt-1 text-sm text-text-2">设置本集标题，创建后可直接进入单集制作。</p>
          </DialogHeaderBar>

          <DialogMain className="min-h-0 flex-1 gap-4 overflow-y-auto p-0">
            <label className="flex flex-col gap-2">
              <span className="text-xs font-medium text-text-1">集标题（可选）</span>
              <Input
                value={newTitle}
                onChange={e => setNewTitle(e.target.value)}
                placeholder="例如：渔业幽梦 · 第 2 集（留空自动命名）"
                className="h-11 rounded-xl text-sm"
              />
            </label>
          </DialogMain>

          <DialogActions className="flex-col items-stretch gap-3 px-10 sm:px-10">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-text-3">项目默认配置和模型可在后续制作时继承或覆盖。</p>
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" className="h-10 rounded-full px-5" onClick={() => setAddDialog(false)} disabled={creating}>
                取消
              </Button>
              <Button
                className="h-10 shrink-0 rounded-full px-6"
                disabled={creating}
                onClick={addEpisode}
              >
                {creating ? '创建中...' : '创建并进入制作页'}
              </Button>
            </div>
          </DialogActions>
        </DialogContent>
      </Dialog>

      <Dialog open={!!previewScriptEpisode} onOpenChange={(open) => { if (!open) setPreviewScriptEpisode(null) }}>
        <DialogContent className="flex max-h-[min(88dvh,820px)] w-[min(720px,calc(100%-2rem))] max-w-[720px] flex-col gap-0 overflow-hidden rounded-[var(--radius-xl)] border-border bg-bg-surface p-0 shadow-shadow-elevated">
          <DialogTitle className="sr-only">分集正文预览</DialogTitle>
          <DialogDescription className="sr-only">
            只读预览当前分集的正文内容，可在关闭后返回列表继续创作或登录后编辑。
          </DialogDescription>
          <DialogHeaderBar className="sm:pb-4">
            <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-text-3">Read only</div>
            <div className="mt-2 text-lg font-bold text-text-0">
              {previewScriptEpisode ? `${previewScriptEpisode.title || `第 ${previewScriptEpisode.episode_number} 集`} · 正文` : ''}
            </div>
          </DialogHeaderBar>
          <DialogMain className="min-h-0 flex-1 overflow-y-auto pt-0">
            {previewScriptEpisode ? (
              <pre className="whitespace-pre-wrap break-words rounded-[var(--radius-md)] border border-border bg-bg-2 p-4 text-sm leading-7 text-text-1">
                {episodePreviewText(previewScriptEpisode) || '（无内容）'}
              </pre>
            ) : null}
          </DialogMain>
          <DialogActions className="border-t border-border px-5 py-4 sm:px-6">
            <Button type="button" variant="outline" className="h-9 rounded-[10px]" onClick={() => setPreviewScriptEpisode(null)}>
              关闭
            </Button>
            <Button type="button" className="h-9 rounded-[10px]" onClick={openLoginNextHere}>
              <LogIn size={15} />
              登录后创作
            </Button>
          </DialogActions>
        </DialogContent>
      </Dialog>

      <Dialog open={!!previewVideoUrl} onOpenChange={(open) => { if (!open) setPreviewVideoUrl(null) }}>
        <DialogContent className="w-[min(960px,calc(100%-2rem))] max-w-[960px] rounded-[var(--radius-xl)] border-border bg-bg-surface p-0 shadow-shadow-elevated">
          <DialogTitle className="sr-only">视频预览</DialogTitle>
          <DialogDescription className="sr-only">
            预览当前短剧分集生成的视频内容，可直接在弹窗内播放查看效果。
          </DialogDescription>
          <DialogHeaderBar className="sm:pb-5">
            <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-text-3">Video Preview</div>
            <div className="mt-2 text-lg font-bold text-text-0">{previewVideoTitle || '视频预览'}</div>
          </DialogHeaderBar>
          <DialogMain className="pt-0">
            {previewVideoUrl ? (
              <video src={previewVideoUrl} controls className="aspect-video w-full rounded-[var(--radius-md)] bg-bg-2" />
            ) : null}
          </DialogMain>
        </DialogContent>
      </Dialog>
    </div>
  )
}
