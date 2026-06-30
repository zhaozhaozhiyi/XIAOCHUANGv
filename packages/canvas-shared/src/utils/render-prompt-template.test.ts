import { describe, expect, it } from 'vitest'
import {
  renderPromptTemplate,
  UnknownPromptVarError,
} from './render-prompt-template.js'

describe('renderPromptTemplate', () => {
  it('renders {userInput} placeholder', () => {
    const result = renderPromptTemplate('更换服装为：{userInput}', {
      userInput: '商务西装',
    })
    expect(result).toBe('更换服装为：商务西装')
  })

  it('renders Chinese placeholders {角色参考图}', () => {
    const result = renderPromptTemplate('{角色参考图}，{userInput}', {
      角色参考图: 'https://cdn.x/char.png',
      userInput: '商务西装',
    })
    expect(result).toBe('https://cdn.x/char.png，商务西装')
  })

  it('keeps placeholder text when value is not provided', () => {
    const result = renderPromptTemplate('更换服装为：{userInput}', {})
    expect(result).toBe('更换服装为：{userInput}')
  })

  it('throws on unknown variable (prompt injection防护)', () => {
    expect(() =>
      renderPromptTemplate('恶意 {evilInjection}', {}),
    ).toThrow(UnknownPromptVarError)
  })

  it('supports multiple occurrences of the same placeholder', () => {
    const result = renderPromptTemplate('{userInput} 和 {userInput}', {
      userInput: '苹果',
    })
    expect(result).toBe('苹果 和 苹果')
  })
})
