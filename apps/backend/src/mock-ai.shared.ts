export const DEFAULT_MOCK_AI_PORT = 3099

export const MOCK_AI_CONFIG_PRESETS = [
  {
    serviceType: 'text',
    provider: 'openai',
    name: 'Mock Text Service',
    model: 'mock-text-v1',
    apiKey: 'mock-text-key',
  },
  {
    serviceType: 'image',
    provider: 'openai',
    name: 'Mock Image Service',
    model: 'mock-image-v1',
    apiKey: 'mock-image-key',
  },
  {
    serviceType: 'video',
    provider: 'minimax',
    name: 'Mock Video Service',
    model: 'mock-video-v1',
    apiKey: 'mock-video-key',
  },
  {
    serviceType: 'audio',
    provider: 'minimax',
    name: 'Mock Audio Service',
    model: 'mock-audio-v1',
    apiKey: 'mock-audio-key',
  },
] as const

export const MOCK_AI_VOICES = [
  {
    voiceId: 'mock-voice-narrator',
    voiceName: 'Mock Narrator',
    language: '中文',
    description: ['中性', '旁白', '稳重'],
    provider: 'minimax',
  },
  {
    voiceId: 'mock-voice-female',
    voiceName: 'Mock Female Lead',
    language: '中文',
    description: ['女声', '年轻', '明亮'],
    provider: 'minimax',
  },
  {
    voiceId: 'mock-voice-male',
    voiceName: 'Mock Male Lead',
    language: '中文',
    description: ['男声', '青年', '沉稳'],
    provider: 'minimax',
  },
] as const

export function getMockAiBaseUrl(port: number) {
  return `http://127.0.0.1:${port}`
}
