import { z } from 'zod'

/**
 * 业务动作 — 双语原则的核心载体
 *
 * 节点定义通过 businessActions 声明自己出现在哪些右键菜单里。
 * 同一个 text-to-image 节点可以同时作为：
 *   - 角色卡右键的"换装/换表情/置入场景"
 *   - 场景卡右键的"换时段/换天气"
 *   - 分镜卡右键的"构想画面/改画面"
 *
 * 新增业务动作不需要新增节点，只需在 businessActions 数组里追加一条。
 */
export const BusinessActionSchema = z.object({
  /** 用户看到的动作名（业务语言）*/
  label: z.string(),

  /** 出现在哪类节点的右键菜单 */
  contextMenu: z.enum(['storyboard', 'character', 'scene', 'global']),

  /**
   * Prompt 模板，含占位符。允许的占位符见 renderPromptTemplate 的 ALLOWED_VARS：
   *   {userInput} - 用户在弹窗输入的文本
   *   {角色参考图} - 当前角色卡的图片
   *   {场景参考图} - 当前场景卡的图片
   *   {characterName} - 角色名
   *   {sceneName} - 场景名
   */
  promptTemplate: z.string(),

  /**
   * 是否在画布上隐藏该节点（直接出图，不暴露节点）
   *
   * true（默认）：业务动作触发后，新节点不在画布上显示，输出直接落到 sourceNode
   *               例如"换装"会创建一个隐藏的 text-to-image 节点，输出图覆盖到角色卡
   * false：节点在画布上显示，让用户可见整个流程
   */
  keepNodeHidden: z.boolean().optional().default(true),
})

export type BusinessAction = z.infer<typeof BusinessActionSchema>
