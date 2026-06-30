import { BadGatewayException, BadRequestException } from '@nestjs/common'

import type { DatabaseService } from '../../db/database.service'
import { getTextProviderBaseUrl } from '../agents/agents.ai'
import { AiConfigResolverService } from '../ai-configs/ai-configs.resolver'

type AiAction = 'continue' | 'polish' | 'summarize' | 'extract_outline'

function getActionPrompt(action: AiAction, args: {
  title: string
  synopsis: string | null
  documentTitle: string
  content: string
  instructions?: string
}) {
  const hint = args.instructions?.trim()
    ? `\n补充要求：${args.instructions.trim()}`
    : ''

  const sharedContext = [
    `作品标题：${args.title}`,
    `作品摘要：${args.synopsis || '无'}`,
    `当前文档：${args.documentTitle}`,
    '请仅输出正文结果，不要解释，不要加代码块。',
    `当前文档内容：\n${args.content || '（当前文档为空）'}`,
  ].join('\n\n')

  switch (action) {
    case 'continue':
      return `你是一名擅长中文叙事与短剧节奏控制的编剧。请基于现有文本继续往后写，保持原有语气、人物关系和情节连续性，直接输出可追加到文稿末尾的新内容。${hint}\n\n${sharedContext}`
    case 'polish':
      return `你是一名中文编辑。请对当前文档做润色，提升表达、节奏与画面感，但不要改变核心情节与人物设定。直接输出润色后的完整文本。${hint}\n\n${sharedContext}`
    case 'summarize':
      return `你是一名内容策划。请用中文提炼当前文档摘要，输出一段简洁摘要，适合放入作品文档摘要区。${hint}\n\n${sharedContext}`
    case 'extract_outline':
      return `你是一名编剧策划。请基于当前文档提炼结构化大纲，使用中文编号列表，突出关键情节推进和冲突。${hint}\n\n${sharedContext}`
    default:
      return sharedContext
  }
}

function extractTextResult(payload: any) {
  const choiceContent = payload?.choices?.[0]?.message?.content
  if (typeof choiceContent === 'string') return choiceContent.trim()
  if (Array.isArray(choiceContent)) {
    return choiceContent
      .map((part) => {
        if (typeof part === 'string') return part
        if (typeof part?.text === 'string') return part.text
        return ''
      })
      .join('')
      .trim()
  }
  return ''
}

export async function runWritingAiAction(
  databaseService: DatabaseService,
  action: AiAction,
  args: {
    title: string
    synopsis: string | null
    documentTitle: string
    content: string
    instructions?: string
  },
) {
  const resolver = new AiConfigResolverService(databaseService)
  const config = await resolver.getActiveConfig('text')
  if (!config) {
    throw new BadRequestException('未配置可用的文本 AI 服务')
  }

  const url = `${getTextProviderBaseUrl(config).replace(/\/+$/, '')}/chat/completions`
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      temperature: action === 'summarize' || action === 'extract_outline' ? 0.4 : 0.7,
      messages: [
        {
          role: 'user',
          content: getActionPrompt(action, args),
        },
      ],
    }),
  })

  if (!response.ok) {
    const message = await response.text().catch(() => '')
    throw new BadGatewayException(message || `AI 请求失败（${response.status}）`)
  }

  const payload = await response.json().catch(() => null)
  const text = extractTextResult(payload)
  if (!text) {
    throw new BadGatewayException('AI 未返回有效文本结果')
  }

  return text
}
