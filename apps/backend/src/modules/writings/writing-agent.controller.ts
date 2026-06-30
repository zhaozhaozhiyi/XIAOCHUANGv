import { BadRequestException, Body, Controller, Get, Inject, Post, Query, Res, UseGuards } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import type { FastifyReply } from 'fastify'

import { DatabaseService } from '../../db/database.service'
import type { CurrentUser as CurrentUserType } from '../auth/auth.types'
import { CurrentUser } from '../auth/current-user.decorator'
import { SessionAuthGuard } from '../auth/session-auth.guard'
import { sendSseReply } from '../ai/skill-handlers/_shared'
import { getTextConfig, getTextProviderBaseUrl } from '../agents/agents.ai'

function extractStreamingText(payload: any) {
  const choice = payload?.choices?.[0]
  const content = choice?.delta?.content ?? choice?.text
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part
        if (typeof part?.text === 'string') return part.text
        if (typeof part?.content === 'string') return part.content
        return ''
      })
      .join('')
  }
  return ''
}

@ApiTags('writing-agent')
@Controller('writing-agent')
@UseGuards(SessionAuthGuard)
export class WritingAgentController {
  constructor(@Inject(DatabaseService) private readonly databaseService: DatabaseService) {}

  @Get('chat')
  async debug(@CurrentUser() _currentUser: CurrentUserType) {
    return { valid: true, type: 'writing-agent' }
  }

  @Post('chat')
  async chat(
    @Body() body: Record<string, unknown>,
    @Query('stream') stream: string | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
    @CurrentUser() _currentUser: CurrentUserType,
  ) {
    const message = typeof body.message === 'string' ? body.message : ''
    const systemPrompt = typeof body.system_prompt === 'string' ? body.system_prompt : ''

    if (stream === '1') {
      const config = await this.getTextConfigOrThrow()
      const encoder = new TextEncoder()
      const decoder = new TextDecoder()
      const transform = new TransformStream()
      const writer = transform.writable.getWriter()

      const send = async (data: unknown, event?: string) => {
        const prefix = event ? `event: ${event}\n` : ''
        await writer.write(encoder.encode(`${prefix}data: ${JSON.stringify(data)}\n\n`))
      }

      void (async () => {
        try {
          await writer.write(encoder.encode(':ok\n\n'))
          await send({ type: 'status', text: '正在生成...' }, 'message')

          const url = `${getTextProviderBaseUrl(config).replace(/\/+$/, '')}/chat/completions`
          const response = await fetch(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${config.apiKey}`,
            },
            body: JSON.stringify({
              model: config.model,
              temperature: 0.7,
              stream: true,
              messages: [
                {
                  role: 'system',
                  content: systemPrompt,
                },
                {
                  role: 'user',
                  content: message,
                },
              ],
            }),
          })

          if (!response.ok) {
            const errorMessage = await response.text().catch(() => '')
            throw new Error(errorMessage || `AI 请求失败（${response.status}）`)
          }
          if (!response.body) throw new Error('AI 流式响应为空')

          const reader = response.body.getReader()
          let buffer = ''

          const consumeBlock = async (block: string) => {
            const dataLines = block
              .split(/\r?\n/)
              .filter((line) => line.startsWith('data:'))
              .map((line) => line.slice(5).trimStart())
            if (!dataLines.length) return

            const data = dataLines.join('\n').trim()
            if (!data || data === '[DONE]') return

            const payload = JSON.parse(data)
            const delta = extractStreamingText(payload)
            if (!delta) return

            await send({ type: 'delta', text: delta }, 'message')
          }

          while (true) {
            const { value, done } = await reader.read()
            if (done) break
            buffer += decoder.decode(value, { stream: true })

            const blocks = buffer.split(/\n\n/)
            buffer = blocks.pop() || ''
            for (const block of blocks) {
              await consumeBlock(block)
            }
          }

          buffer += decoder.decode()
          if (buffer.trim()) await consumeBlock(buffer)

          await send({ type: 'done' }, 'message')
        } catch (error) {
          const messageText = error instanceof Error ? error.message : 'Agent execution failed'
          try {
            await send({ type: 'error', message: messageText }, 'message')
          } catch {
            // ignore
          }
        } finally {
          try {
            await writer.close()
          } catch {
            // ignore
          }
        }
      })()

      return sendSseReply(reply, transform.readable)
    }

    const config = await this.getTextConfigOrThrow()
    const url = `${getTextProviderBaseUrl(config).replace(/\/+$/, '')}/chat/completions`
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        temperature: 0.7,
        messages: [
          {
            role: 'system',
            content: systemPrompt,
          },
          {
            role: 'user',
            content: message,
          },
        ],
      }),
    })

    if (!response.ok) {
      const errorMessage = await response.text().catch(() => '')
      throw new BadRequestException(errorMessage || `AI 请求失败（${response.status}）`)
    }

    const payload = await response.json() as any
    const content = payload?.choices?.[0]?.message?.content
    return { type: 'done', text: typeof content === 'string' ? content : '' }
  }

  private async getTextConfigOrThrow() {
    try {
      return await getTextConfig(this.databaseService)
    } catch {
      throw new BadRequestException('未配置可用的文本 AI 服务')
    }
  }
}
