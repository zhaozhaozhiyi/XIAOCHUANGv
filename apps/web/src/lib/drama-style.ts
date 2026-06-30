/** Stored/API values for `dramas.style` (English slugs for generation pipelines). */

export const DRAMA_STYLE_VALUES = [
  'realistic',
  'anime',
  'ghibli',
  'cinematic',
  'comic',
  'watercolor',
] as const

export type DramaStyleValue = (typeof DRAMA_STYLE_VALUES)[number]

export const DEFAULT_DRAMA_STYLE: DramaStyleValue = 'realistic'

const LABELS: Record<DramaStyleValue, string> = {
  realistic: '写实',
  anime: '二次元',
  ghibli: '吉卜力',
  cinematic: '电影感',
  comic: '漫画',
  watercolor: '水彩',
}

/**
 * English prompt hint appended to image/video prompts so all generation
 * pipelines share one visual style source-of-truth (drama.style).
 */
const PROMPT_HINTS: Record<DramaStyleValue, string> = {
  realistic: 'cinematic realistic style, photo-realistic rendering, natural lighting, high detail',
  anime: 'anime style, japanese 2D illustration, cel shading, clean line art, vibrant colors',
  ghibli: 'Studio Ghibli inspired, hand-drawn anime, soft watercolor backgrounds, warm palette, nostalgic atmosphere',
  cinematic: 'cinematic film still, dramatic lighting, shallow depth of field, filmic color grading, high production value',
  comic: 'comic book style, bold ink lines, vibrant flat colors, halftone shading, dynamic composition',
  watercolor: 'watercolor painting, soft brush strokes, artistic washes, paper texture, gentle color bleed',
}

/**
 * Warnings surfaced in UI to nudge users away from styles likely to
 * collide with provider content-safety policies.
 */
const STYLE_WARNINGS: Partial<Record<DramaStyleValue, string>> = {
  realistic: '写实风格的真人画面可能被视频生成平台的真人内容安全检测拦截，如遇失败可改为其他风格重试。',
}

export function dramaStyleLabel(style: string | null | undefined): string {
  if (!style) return ''
  return (LABELS as Record<string, string>)[style] ?? style
}

/**
 * Returns the English style hint for a drama.style value. Unknown or missing
 * values fall back to the default (realistic) so downstream prompts always
 * have a stable style anchor.
 */
export function dramaStylePromptHint(style: string | null | undefined): string {
  const key = (style || '').trim() as DramaStyleValue
  return PROMPT_HINTS[key] ?? PROMPT_HINTS[DEFAULT_DRAMA_STYLE]
}

export function dramaStyleWarning(style: string | null | undefined): string {
  const key = (style || '').trim() as DramaStyleValue
  return STYLE_WARNINGS[key] ?? ''
}

/**
 * Append the drama style hint to a prompt. Skips if the prompt is empty or
 * already contains the hint (idempotent — safe to call multiple times).
 */
export function appendDramaStyleHint(prompt: string, style: string | null | undefined): string {
  const trimmed = String(prompt || '').trim()
  if (!trimmed) return trimmed
  const hint = dramaStylePromptHint(style)
  if (!hint) return trimmed
  if (trimmed.toLowerCase().includes(hint.toLowerCase())) return trimmed
  return `${trimmed}，${hint}`
}

export const dramaStyleSelectOptions = DRAMA_STYLE_VALUES.map((value) => ({
  value,
  label: LABELS[value],
}))
