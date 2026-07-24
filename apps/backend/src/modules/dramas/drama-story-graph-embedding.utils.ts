import { createHash } from 'node:crypto'

export const LOCAL_EMBEDDING_DIM = 256

export function normalizeVector(vec: number[]) {
  const norm = Math.sqrt(vec.reduce((sum, value) => sum + value * value, 0)) || 1
  return vec.map((value) => value / norm)
}

export function localHashEmbedding(text: string, dimensions = LOCAL_EMBEDDING_DIM) {
  const vec = new Array(dimensions).fill(0)
  const normalized = text.toLowerCase().replace(/\s+/g, ' ').trim()
  if (!normalized) return vec

  for (let index = 0; index < normalized.length; index += 1) {
    const code = normalized.charCodeAt(index)
    vec[(code * (index + 3)) % dimensions] += 1
  }

  for (let index = 0; index < normalized.length - 1; index += 1) {
    const pair = normalized.charCodeAt(index) * 257 + normalized.charCodeAt(index + 1)
    vec[pair % dimensions] += 0.5
  }

  const tokens = normalized.split(/[^\p{L}\p{N}]+/u).filter(Boolean)
  for (const token of tokens) {
    const digest = createHash('sha256').update(token).digest()
    for (let byteIndex = 0; byteIndex < digest.length; byteIndex += 1) {
      vec[digest[byteIndex] % dimensions] += 0.25
    }
  }

  return normalizeVector(vec)
}

export function cosineSimilarity(left: number[], right: number[]) {
  const length = Math.min(left.length, right.length)
  let dot = 0
  for (let index = 0; index < length; index += 1) {
    dot += left[index] * right[index]
  }
  return dot
}

export function keywordScore(query: string, content: string) {
  const normalizedQuery = query.toLowerCase().trim()
  const normalizedContent = content.toLowerCase()
  if (!normalizedQuery || !normalizedContent) return 0

  if (normalizedContent.includes(normalizedQuery)) {
    return 0.35 + Math.min(0.35, normalizedQuery.length / Math.max(normalizedContent.length, 1))
  }

  const tokens = normalizedQuery.split(/\s+/).filter((token) => token.length >= 2)
  if (!tokens.length) return 0

  let hits = 0
  for (const token of tokens) {
    if (normalizedContent.includes(token)) hits += 1
  }
  return hits / tokens.length * 0.25
}

export function blendSearchScore(semantic: number, keyword: number) {
  return semantic * 0.75 + keyword * 0.25
}
