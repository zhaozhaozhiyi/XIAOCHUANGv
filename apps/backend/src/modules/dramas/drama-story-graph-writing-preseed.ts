import { createHash } from 'node:crypto'

type GraphEntityDraft = {
  entityType: 'character' | 'scene' | 'prop'
  canonicalName: string
  displayName?: string
  role?: string
  description?: string
  importance?: number
  firstSeen?: Record<string, unknown>
  sourceTrace?: Array<Record<string, unknown>>
  aliases?: string[]
}

type GraphRelationDraft = {
  subjectName: string
  objectName: string
  relationType: string
  predicate: string
  description?: string
  evidence?: Array<Record<string, unknown>>
}

type GraphEventDraft = {
  episodeId?: number
  episodeNumber: number
  title: string
  summary?: string
  scriptSpanStart?: number
  scriptSpanEnd?: number
  involvedNames?: string[]
  emotionalTone?: string
}

export type StoryGraphExtractedDraft = {
  entities: GraphEntityDraft[]
  relations: GraphRelationDraft[]
  events: GraphEventDraft[]
}

type WritingKnowledgeCardRow = {
  id: number
  cardType: string
  title: string
  content: string
}

function normalizeName(value: string) {
  return value.replace(/\s+/g, '').trim()
}

function entityKey(entityType: string, canonicalName: string) {
  return `${entityType}:${normalizeName(canonicalName)}`
}

function mapCardTypeToEntityType(cardType: string): 'character' | 'scene' | 'prop' {
  if (cardType === 'character') return 'character'
  if (cardType === 'setting') return 'scene'
  return 'prop'
}

function inferCanonicalName(card: WritingKnowledgeCardRow) {
  const title = String(card.title || '').trim()
  if (title) return title
  const firstLine = String(card.content || '').split('\n').map((line) => line.trim()).find(Boolean)
  return firstLine || `知识卡#${card.id}`
}

export function mergeWritingKnowledgeCards(
  extracted: StoryGraphExtractedDraft,
  cards: WritingKnowledgeCardRow[],
) {
  if (!cards.length) return extracted

  const entityMap = new Map(
    extracted.entities.map((entity) => [entityKey(entity.entityType, entity.canonicalName), { ...entity }]),
  )
  const relations = [...extracted.relations]
  const events = [...extracted.events]

  for (const card of cards) {
    const cardType = String(card.cardType || '').trim() || 'setting'
    const canonicalName = inferCanonicalName(card)
    const entityType = mapCardTypeToEntityType(cardType)
    const key = entityKey(entityType, canonicalName)
    const description = String(card.content || '').trim()
    const existing = entityMap.get(key)

    if (existing) {
      existing.importance = Math.max(existing.importance || 0, 0.65)
      if (!existing.description && description) existing.description = description
      existing.sourceTrace = [
        ...(existing.sourceTrace || []),
        { kind: 'writing_knowledge_card', card_id: card.id, card_type: cardType },
      ]
      entityMap.set(key, existing)
      continue
    }

    entityMap.set(key, {
      entityType,
      canonicalName,
      displayName: canonicalName,
      role: cardType === 'character' ? 'supporting' : cardType,
      description: description || undefined,
      importance: cardType === 'character' ? 0.7 : 0.55,
      sourceTrace: [{ kind: 'writing_knowledge_card', card_id: card.id, card_type: cardType }],
      aliases: [],
    })

    if (cardType === 'plotline' || cardType === 'foreshadowing') {
      events.push({
        episodeNumber: 0,
        title: canonicalName,
        summary: description.slice(0, 240) || undefined,
        involvedNames: [],
        emotionalTone: cardType,
      })
    }
  }

  return {
    entities: Array.from(entityMap.values()),
    relations,
    events,
  }
}

export function hashChunkContent(content: string) {
  return createHash('sha256').update(content).digest('hex')
}

export function splitScriptIntoChunks(script: string, chunkSize = 420) {
  const normalized = String(script || '').trim()
  if (!normalized) return [] as string[]

  const paragraphs = normalized.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean)
  const chunks: string[] = []
  let buffer = ''

  for (const paragraph of paragraphs) {
    if (!buffer) {
      if (paragraph.length <= chunkSize) {
        buffer = paragraph
        continue
      }
      for (let offset = 0; offset < paragraph.length; offset += chunkSize) {
        chunks.push(paragraph.slice(offset, offset + chunkSize))
      }
      continue
    }

    if (`${buffer}\n\n${paragraph}`.length <= chunkSize) {
      buffer = `${buffer}\n\n${paragraph}`
      continue
    }

    chunks.push(buffer)
    buffer = paragraph.length <= chunkSize
      ? paragraph
      : paragraph.slice(0, chunkSize)
    if (paragraph.length > chunkSize) {
      for (let offset = chunkSize; offset < paragraph.length; offset += chunkSize) {
        chunks.push(paragraph.slice(offset, offset + chunkSize))
      }
      buffer = ''
    }
  }

  if (buffer) chunks.push(buffer)
  return chunks
}
