const IGNORE_TTS_SPEAKERS = /^(环境音|环境声|音效|效果音|sfx|sound ?effect|bgm|背景音|背景音乐|ambient)$/i
const IGNORE_TTS_TEXT = /^(无|无对白|无台词|无旁白|无需配音|无需对白|none|null|n\/a|na|环境音|环境声|音效|效果音|纯音效|纯环境音|只有环境音|仅环境音|背景音|背景音乐|bgm|sfx|ambient)$/i
const DIALOGUE_LINE_RE = /^([\u4e00-\u9fa5A-Za-z0-9_·]{1,16})\s*[:：]\s*(.+)$/
const NARRATIVE_SPEAKER_RE = /(说|问|喊|叫|想|道|发誓|表示|补充|转向|拿起|放下|暗暗)/
const NARRATOR_SPEAKER_RE = /^(旁白|画外音|narrator)$/i

export interface ParsedDialogueForTTS {
  speaker: string
  pureText: string
  ignorable: boolean
}

export function parseDialogueForTTS(dialogue?: string | null): ParsedDialogueForTTS {
  const raw = dialogue?.trim() || ''
  if (!raw) return { speaker: '', pureText: '', ignorable: true }

  const speakerMatch = raw.match(/^(.+?)[:：]/)
  const speaker = speakerMatch ? speakerMatch[1].replace(/[（(].+?[)）]/g, '').trim() : ''
  const pureText = raw
    .split(/\n+/)
    .map((line) => line.replace(/^.+?[:：]\s*/, '').replace(/[（(].+?[)）]/g, '').trim())
    .filter(Boolean)
    .join('\n')
  const ignorable = (!!speaker && IGNORE_TTS_SPEAKERS.test(speaker)) || !pureText || IGNORE_TTS_TEXT.test(pureText)

  return { speaker, pureText, ignorable }
}

export function extractDialogueFromDescription(description?: string | null) {
  const text = description?.replace(/\r?\n/g, ' ').trim() || ''
  if (!text) return ''

  const lines: string[] = []
  const sentences = text.split(/(?<=[。！？!?])\s+|(?<=\.\.\.)\s+|(?<=……)\s+/)
  for (const sentence of sentences) {
    const match = sentence.match(DIALOGUE_LINE_RE)
    if (!match) continue
    const speaker = match[1]?.trim()
    const content = match[2]?.trim()
    if (!speaker || !content) continue
    if (NARRATIVE_SPEAKER_RE.test(speaker) && !NARRATOR_SPEAKER_RE.test(speaker)) continue
    const parsed = parseDialogueForTTS(`${speaker}：${content}`)
    if (!parsed.ignorable) lines.push(`${speaker}：${content}`)
  }

  return lines.join('\n')
}

export function getStoryboardTtsDialogue(storyboard: {
  dialogue?: string | null
  description?: string | null
}) {
  const dialogue = storyboard.dialogue?.trim()
  if (dialogue) {
    const parsed = parseDialogueForTTS(dialogue)
    return parsed.ignorable ? '' : dialogue
  }

  const extracted = extractDialogueFromDescription(storyboard.description)
  if (!extracted) return ''
  const parsed = parseDialogueForTTS(extracted)
  return parsed.ignorable ? '' : extracted
}
