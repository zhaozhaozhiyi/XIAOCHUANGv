import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'

import { DEFAULT_MOCK_AI_PORT, MOCK_AI_CONFIG_PRESETS, MOCK_AI_VOICES, getMockAiBaseUrl } from './mock-ai.shared'

const PNG_1X1_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wn3n0cAAAAASUVORK5CYII='

function parsePort() {
  const arg = process.argv.find((item) => item.startsWith('--port='))
  const value = Number(arg?.slice('--port='.length) || process.env.MOCK_AI_PORT || DEFAULT_MOCK_AI_PORT)
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_MOCK_AI_PORT
}

function createToneWavBuffer(durationSeconds: number, frequency = 440) {
  const sampleRate = 24_000
  const channels = 1
  const bytesPerSample = 2
  const totalSamples = Math.max(1, Math.floor(durationSeconds * sampleRate))
  const dataSize = totalSamples * channels * bytesPerSample
  const buffer = Buffer.alloc(44 + dataSize)

  buffer.write('RIFF', 0)
  buffer.writeUInt32LE(36 + dataSize, 4)
  buffer.write('WAVE', 8)
  buffer.write('fmt ', 12)
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)
  buffer.writeUInt16LE(channels, 22)
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(sampleRate * channels * bytesPerSample, 28)
  buffer.writeUInt16LE(channels * bytesPerSample, 32)
  buffer.writeUInt16LE(bytesPerSample * 8, 34)
  buffer.write('data', 36)
  buffer.writeUInt32LE(dataSize, 40)

  for (let index = 0; index < totalSamples; index += 1) {
    const sample = Math.round(Math.sin((2 * Math.PI * frequency * index) / sampleRate) * 0.2 * 32767)
    buffer.writeInt16LE(sample, 44 + index * bytesPerSample)
  }

  return buffer
}

function createSampleVideo(outputPath: string, color: string, durationSeconds: number) {
  execFileSync(
    'ffmpeg',
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      `color=c=${color}:s=160x90:d=${durationSeconds}`,
      '-frames:v',
      String(Math.max(1, Math.round(durationSeconds * 24))),
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-pix_fmt',
      'yuv420p',
      '-movflags',
      '+faststart',
      outputPath,
    ],
    { stdio: 'pipe' },
  )
}

async function readJsonBody(request: IncomingMessage) {
  const chunks: Buffer[] = []
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  if (!chunks.length) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

function sendJson(response: ServerResponse, payload: unknown) {
  const body = Buffer.from(`${JSON.stringify(payload)}\n`, 'utf8')
  response.statusCode = 200
  response.setHeader('Content-Type', 'application/json')
  response.setHeader('Content-Length', String(body.byteLength))
  response.end(body)
}

function sendBuffer(response: ServerResponse, buffer: Buffer, mimeType: string) {
  response.statusCode = 200
  response.setHeader('Content-Type', mimeType)
  response.setHeader('Content-Length', String(buffer.byteLength))
  response.end(buffer)
}

function extractMessageContent(body: Record<string, any>) {
  const messages = Array.isArray(body.messages) ? body.messages : []
  const content = messages[messages.length - 1]?.content
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part
        if (typeof part?.text === 'string') return part.text
        return ''
      })
      .join('\n')
  }
  return String(content || '')
}

function extractBalancedJson(source: string, marker: string) {
  const markerIndex = source.indexOf(marker)
  if (markerIndex < 0) return null
  const startIndex = source.indexOf('{', markerIndex)
  if (startIndex < 0) return null

  let depth = 0
  let inString = false
  let escaped = false

  for (let index = startIndex; index < source.length; index += 1) {
    const char = source[index]
    if (inString) {
      if (escaped) {
        escaped = false
      } else if (char === '\\') {
        escaped = true
      } else if (char === '"') {
        inString = false
      }
      continue
    }

    if (char === '"') {
      inString = true
      continue
    }
    if (char === '{') depth += 1
    if (char === '}') {
      depth -= 1
      if (depth === 0) {
        return source.slice(startIndex, index + 1)
      }
    }
  }

  return null
}

function parseContextJson(prompt: string) {
  const raw = extractBalancedJson(prompt, '上下文 JSON：')
  if (!raw) return null
  try {
    return JSON.parse(raw) as Record<string, any>
  } catch {
    return null
  }
}

function buildStoryboardPayload(prompt: string) {
  const context = parseContextJson(prompt)
  const scenes = Array.isArray(context?.scenes) ? context?.scenes : []
  const characters = Array.isArray(context?.characters) ? context?.characters : []
  const firstScene = scenes[0] || {}
  const sceneId = typeof firstScene.id === 'number' ? firstScene.id : null
  const characterIds = characters
    .map((item) => Number(item?.id))
    .filter((item) => Number.isInteger(item) && item > 0)
    .slice(0, 2)
  const styleHint = String(context?.style_hint || 'cinematic realistic style').trim()
  const location = String(firstScene.location || '客厅').trim() || '客厅'
  const time = String(firstScene.time || '夜晚').trim() || '夜晚'

  return {
    storyboards: [
      {
        shot_number: 1,
        title: 'Mock 开场镜头',
        shot_type: '中景',
        angle: '平视',
        movement: '缓慢推进',
        location,
        time,
        action: '角色走入空间，短暂停顿，观察四周环境。',
        dialogue: '',
        description: '人物进入场景，环境关系与气氛被建立。',
        result: '交代空间和人物状态，为后续冲突做铺垫。',
        atmosphere: '克制、悬疑',
        image_prompt: `cinematic frame, ${styleHint}, character entering room, medium shot, moody lighting, high detail`,
        video_prompt: '角色进入场景，镜头缓慢推进，停顿观察，电影感，动作自然',
        bgm_prompt: '低频悬疑氛围，克制推进，轻微紧张感',
        sound_effect: '轻微脚步声，室内环境底噪',
        duration: 6,
        scene_id: sceneId,
        character_ids: characterIds,
      },
    ],
  }
}

function buildJsonContent(prompt: string) {
  if (prompt.includes('"storyboards"')) {
    return JSON.stringify(buildStoryboardPayload(prompt))
  }
  if (prompt.includes('"assignments"')) {
    return JSON.stringify({ assignments: [] })
  }
  if (prompt.includes('"characters"') && prompt.includes('"scenes"')) {
    return JSON.stringify({ characters: [], scenes: [] })
  }
  return JSON.stringify({ ok: true })
}

function buildTextContent(prompt: string) {
  if (prompt.includes('输出必须从第一场场景头开始')) {
    return [
      '## S01 | 内景 · 客厅 | 夜晚',
      '林夏推门进屋，客厅只亮着一盏昏黄的落地灯。',
      '林夏：（压低声音）你还没睡？',
      '顾沉放下手里的杯子，没有立刻回答，只是抬眼看她。',
      '',
      '## S02 | 内景 · 客厅 | 连续',
      '空气安静得只剩时钟声，林夏一步步靠近，试图看清他的情绪。',
      '顾沉：（克制）你今天回来的，比平时晚。',
    ].join('\n')
  }
  if (prompt.includes('润色后的完整文本')) {
    return '这是 mock 润色结果。语言更凝练，节奏更顺，保留了原有情节和人物关系。'
  }
  if (prompt.includes('提炼当前文档摘要')) {
    return '这是 mock 摘要：主角在平静表象下遭遇新的情感与行动冲突，剧情进入下一阶段。'
  }
  if (prompt.includes('结构化大纲') || prompt.includes('编号列表')) {
    return '1. 主角进入场景并发现异常。\n2. 关键人物对话，冲突被点燃。\n3. 情节留下悬念，推动后续发展。'
  }
  if (prompt.includes('继续往后写')) {
    return '这是 mock 续写内容。人物关系继续推进，新的冲突被自然引出，结尾保留悬念。'
  }
  return '这是 mock 文本结果，用于本地联调。'
}

async function sendStreamResponse(response: ServerResponse, content: string) {
  response.statusCode = 200
  response.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
  response.setHeader('Cache-Control', 'no-cache, no-transform')
  response.setHeader('Connection', 'keep-alive')

  const chunks = content.match(/[\s\S]{1,24}/g) || [content]
  for (const chunk of chunks) {
    response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: chunk } }] })}\n\n`)
  }
  response.write('data: [DONE]\n\n')
  response.end()
}

async function main() {
  const port = parsePort()
  const baseUrl = getMockAiBaseUrl(port)
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xiaochuang-mock-ai-'))
  const pngBuffer = Buffer.from(PNG_1X1_BASE64, 'base64')
  const wavBuffer = createToneWavBuffer(0.8)
  const videoPath = path.join(tempDir, 'mock-video.mp4')
  createSampleVideo(videoPath, 'green', 1.6)
  const videoBuffer = fs.readFileSync(videoPath)

  const server = createServer(async (request, response) => {
    try {
      if (!request.url) {
        response.statusCode = 404
        response.end()
        return
      }

      if (request.method === 'GET' && request.url === '/health') {
        sendJson(response, { ok: true, base_url: baseUrl })
        return
      }

      if (request.method === 'GET' && request.url === '/stub/image.png') {
        sendBuffer(response, pngBuffer, 'image/png')
        return
      }

      if (request.method === 'GET' && request.url === '/stub/video.mp4') {
        sendBuffer(response, videoBuffer, 'video/mp4')
        return
      }

      if (request.method === 'GET' && request.url === '/stub/audio.wav') {
        sendBuffer(response, wavBuffer, 'audio/wav')
        return
      }

      if (request.method === 'GET' && request.url === '/v1/models') {
        sendJson(response, {
          object: 'list',
          data: MOCK_AI_CONFIG_PRESETS.map((item) => ({ id: item.model, object: 'model', owned_by: 'mock-ai' })),
        })
        return
      }

      if (request.method === 'POST' && request.url === '/v1/chat/completions') {
        const body = await readJsonBody(request)
        const prompt = extractMessageContent(body)
        const content = body.response_format?.type === 'json_object' || prompt.includes('只返回一个 JSON 对象')
          ? buildJsonContent(prompt)
          : buildTextContent(prompt)

        if (body.stream === true) {
          await sendStreamResponse(response, content)
          return
        }

        sendJson(response, {
          id: 'mock-chat-completion',
          object: 'chat.completion',
          choices: [
            {
              index: 0,
              finish_reason: 'stop',
              message: {
                role: 'assistant',
                content,
              },
            },
          ],
        })
        return
      }

      if (request.method === 'POST' && request.url === '/v1/images/generations') {
        await readJsonBody(request)
        sendJson(response, {
          created: Date.now(),
          data: [{ url: `${baseUrl}/stub/image.png` }],
        })
        return
      }

      if (request.method === 'GET' && request.url.startsWith('/v1/images/task/')) {
        sendJson(response, {
          status: 'completed',
          data: [{ url: `${baseUrl}/stub/image.png` }],
        })
        return
      }

      if (request.method === 'POST' && request.url === '/v1/video_generation') {
        await readJsonBody(request)
        sendJson(response, {
          video_url: `${baseUrl}/stub/video.mp4`,
        })
        return
      }

      if (request.method === 'GET' && request.url.startsWith('/v1/video_generation/task/')) {
        sendJson(response, {
          status: 'completed',
          video_url: `${baseUrl}/stub/video.mp4`,
        })
        return
      }

      if (request.method === 'POST' && request.url === '/v1/t2a_v2') {
        await readJsonBody(request)
        sendJson(response, {
          base_resp: {
            status_code: 0,
            status_msg: 'success',
          },
          data: {
            audio: wavBuffer.toString('hex'),
            extra_info: {
              audio_length: 800,
              audio_sample_rate: 24_000,
              bitrate: 384_000,
              audio_format: 'wav',
              audio_channel: 1,
            },
          },
        })
        return
      }

      if (request.method === 'POST' && request.url === '/v1/get_voice') {
        await readJsonBody(request)
        sendJson(response, {
          base_resp: {
            status_code: 0,
            status_msg: 'success',
          },
          system_voice: MOCK_AI_VOICES.map((voice) => ({
            voice_id: voice.voiceId,
            voice_name: voice.voiceName,
            description: [...voice.description],
          })),
        })
        return
      }

      response.statusCode = 404
      response.end()
    } catch (error) {
      response.statusCode = 500
      response.end(error instanceof Error ? error.message : String(error))
    }
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => resolve())
  })

  const address = server.address() as AddressInfo | null
  if (!address) {
    throw new Error('Failed to bind mock AI server')
  }

  console.log(`Mock AI server listening on ${baseUrl}`)
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
