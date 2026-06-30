import { z } from 'zod'
import { PortTypeSchema } from './port-type.js'
import { BusinessActionSchema } from './business-action.js'

/**
 * 节点端口（输入或输出）
 */
const PortSchema = z.object({
  /** 端口唯一标识（在节点内）*/
  name: z.string(),
  /** 用户看到的端口名（业务语言）*/
  label: z.string(),
  /** 端口数据类型 */
  type: PortTypeSchema,
  /**
   * 是否必须连入（仅 input 有意义；output 端口写不写都行，默认 false）
   * 注：zod input 类型不能用 .default()，所以这里写 .optional()，运行时通过 transform 默认 false。
   */
  required: z.boolean().optional(),
  /** 是否允许多条连接（仅 input 有意义）*/
  multiple: z.boolean().optional(),
})

export type Port = z.infer<typeof PortSchema>

/**
 * 节点参数（不走连线，节点内部 UI 配置）
 */
const ParamSchema = z.object({
  name: z.string(),
  label: z.string(),
  type: z.enum(['select', 'text', 'number', 'slider', 'color']),
  default: z.unknown().optional(),
  options: z
    .array(z.object({
      value: z.string(),
      label: z.string(),
    }))
    .optional(),
})

export type Param = z.infer<typeof ParamSchema>

/**
 * 执行器声明 — v0.2 关键抽象
 *
 * - module: 路由到 apps/backend/src/modules/* 现有业务模块
 * - skill: 路由到 skills/ + apps/backend/src/modules/skills（v0.2.0 仅 storyboard_breaker、voice_assigner 用）
 * - custom: 预留 v0.3 用户自定义节点（v0.2.x 不接受）
 */
const ExecutorSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('module'),
    module: z.string(),
    method: z.string(),
  }),
  z.object({
    kind: z.literal('skill'),
    skillId: z.string(),
  }),
  z.object({
    kind: z.literal('custom'),
    handler: z.string(),
  }),
])

export type Executor = z.infer<typeof ExecutorSchema>

/**
 * UI 提示
 */
const UiHintSchema = z.object({
  /** 节点强调色（hex）*/
  accentColor: z.string().optional(),
  /** 平均执行耗时（秒），用于 ETA 估算 */
  estimatedDuration: z.number().optional(),
  /** 平均消耗（积分），用于 Q24 消耗预估 */
  estimatedCost: z.number().optional(),
})

/**
 * 节点定义 — 前后端共享的核心 schema
 *
 * 每个节点同时持有 businessName（用户语言）和 technicalName（开发语言），
 * 实现 PRD §3.6 双语原则。
 */
export const CanvasNodeDefinitionSchema = z.object({
  /** 唯一标识（kebab-case），与 canvas_nodes.node_def_id 对应 */
  id: z.string(),

  /** 分类 */
  category: z.enum(['content', 'execute']),

  /** 用户看到的节点名（业务语言） */
  businessName: z.string(),

  /** 开发/调试看到的节点名（技术语言） */
  technicalName: z.string(),

  /** 图标（emoji 或图标 ID） */
  icon: z.string(),

  /** 简短描述（业务语言） */
  description: z.string(),

  /** 输入端口 */
  inputs: z.array(PortSchema).optional(),

  /** 输出端口 */
  outputs: z.array(PortSchema).optional(),

  /** 节点内部参数（不走连线） */
  params: z.array(ParamSchema).optional(),

  /** 执行器（仅 execute 类节点必填） */
  executor: ExecutorSchema.optional(),

  /** UI 提示 */
  ui: UiHintSchema.optional(),

  /** 业务动作绑定（双语原则的核心载体） */
  businessActions: z.array(BusinessActionSchema).optional(),

  /** 此节点在哪些版本可用（默认 ['v0.2.0']）*/
  availableInVersions: z.array(z.string()).optional(),
})

export type CanvasNodeDefinition = z.infer<typeof CanvasNodeDefinitionSchema>
