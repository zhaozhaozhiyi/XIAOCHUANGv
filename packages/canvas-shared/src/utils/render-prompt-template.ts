/**
 * promptTemplate 占位符解析 —— 安全白名单
 *
 * 详见 TRD §8.7。
 *
 * 允许的占位符：
 *   {userInput}       - 用户在弹窗输入的文本
 *   {角色参考图}      - 当前角色卡的图片 URL
 *   {场景参考图}      - 当前场景卡的图片 URL
 *   {characterName}   - 角色名
 *   {sceneName}       - 场景名
 *
 * 未在白名单的占位符会抛错（防止 prompt 注入）。
 * 已声明但未传值的占位符会保留原文（便于调试）。
 */

const PLACEHOLDER_PATTERN = /\{([a-zA-Z_一-龥]+)\}/g

export const ALLOWED_PROMPT_VARS = [
  'userInput',
  '角色参考图',
  '场景参考图',
  'characterName',
  'sceneName',
] as const

export type PromptVarName = (typeof ALLOWED_PROMPT_VARS)[number]

export type PromptVars = Partial<Record<PromptVarName, string>>

export class UnknownPromptVarError extends Error {
  constructor(public readonly varName: string) {
    super(`Unknown prompt template variable: ${varName}`)
    this.name = 'UnknownPromptVarError'
  }
}

export function renderPromptTemplate(template: string, vars: PromptVars): string {
  return template.replace(PLACEHOLDER_PATTERN, (match, name: string) => {
    if (!(ALLOWED_PROMPT_VARS as readonly string[]).includes(name)) {
      throw new UnknownPromptVarError(name)
    }
    const value = vars[name as PromptVarName]
    return value !== undefined ? value : match
  })
}
