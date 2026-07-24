import { describe, expect, it } from 'vitest'

import {
  assertDialogueVoiceLanguageSupported,
  getDialogueVoiceCapabilities,
} from './audio.capabilities'

describe('dialogue voice capabilities', () => {
  it('requires an explicit language declaration for providers without a safe default', () => {
    expect(() =>
      assertDialogueVoiceLanguageSupported({
        config: {
          provider: 'minimax',
          baseUrl: 'https://tts.example',
          apiKey: 'test',
          model: 'speech',
          settings: {},
        },
        voiceId: 'voice-1',
        languageTag: 'zh-CN',
      }),
    ).toThrow('voice_language_unsupported')
  })

  it('honors a voice-specific BCP 47 declaration before the general model list', () => {
    const result = assertDialogueVoiceLanguageSupported({
      config: {
        provider: 'minimax',
        baseUrl: 'https://tts.example',
        apiKey: 'test',
        model: 'speech',
        settings: {
          supported_language_tags: ['zh-CN', 'en-US'],
          voice_language_map: {
            'voice-en': ['en'],
          },
        },
      },
      voiceId: 'voice-en',
      languageTag: 'en-US',
    })

    expect(result.languageTag).toBe('en-US')
    expect(result.capabilities.voiceLanguageMap['voice-en']).toEqual(['en'])
    expect(() =>
      assertDialogueVoiceLanguageSupported({
        config: {
          provider: 'minimax',
          baseUrl: 'https://tts.example',
          apiKey: 'test',
          model: 'speech',
          settings: {
            supported_language_tags: ['zh-CN', 'en-US'],
            voice_language_map: {
              'voice-en': ['en'],
            },
          },
        },
        voiceId: 'voice-en',
        languageTag: 'zh-CN',
      }),
    ).toThrow('voice_language_unsupported')
  })

  it('declares the built-in VolcEngine Chinese contract when no override exists', () => {
    const capabilities = getDialogueVoiceCapabilities({
      provider: 'volcengine',
      baseUrl: 'wss://tts.example',
      apiKey: 'test',
      model: 'voice',
      settings: {},
    })

    expect(capabilities.supportedLanguageTags).toEqual(['zh-CN'])
  })
})
