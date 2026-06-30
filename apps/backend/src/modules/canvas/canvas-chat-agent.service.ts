import { Inject, Injectable } from '@nestjs/common'
import { CanvasSkillOperation, CanvasSkillService } from './canvas-skill.service'

type ChatInput = {
  message: string
  selected_node_ids?: string[]
}

@Injectable()
export class CanvasChatAgentService {
  constructor(@Inject(CanvasSkillService) private readonly skillService: CanvasSkillService) {}

  async handle(canvasId: string, userId: number, input: ChatInput) {
    const message = String(input.message || '').trim()
    const selectedNodeId = input.selected_node_ids?.[0]

    if (!message) {
      return { type: 'message', content: '请先描述创意或选择要调整的节点。' }
    }

    if (/删除|连线|入库|保存到资产/.test(message)) {
      return { type: 'message', content: '这个动作暂未开放对话 Skill，请先在画布上手动操作。' }
    }

    if (/生成(图片|视频|音频|配音|画面|镜头视频)|出图|渲染/.test(message) && !/分镜|草稿/.test(message)) {
      return { type: 'message', content: '这个动作暂未开放对话 Skill，请先在画布上手动操作。' }
    }

    if (/修改|调整|改成|改为|换成/.test(message)) {
      if (!selectedNodeId) {
        return { type: 'message', content: '请先选中要修改的节点，我会给出修改计划。' }
      }
      const patch = this.patchFromMessage(message)
      const operations: CanvasSkillOperation[] = [{ type: 'update_node', node_id: selectedNodeId, patch }]
      return {
        type: 'plan',
        plan: {
          title: '修改选中节点',
          summary: '将根据你的描述更新节点文本字段，确认后执行。',
          operations,
        },
      }
    }

    if (/上下文|参考|加入/.test(message) && selectedNodeId) {
      const outputs = await this.skillService.applyPlan(canvasId, userId, [{ type: 'add_to_context', node_id: selectedNodeId }])
      return { type: 'skill_result', skill: 'canvas.add_to_context', outputs, content: '已加入本轮对话上下文。' }
    }

    const nodes = this.storyboardDraftFromMessage(message)
    const outputs = await this.skillService.createNodes(canvasId, userId, nodes)
    return {
      type: 'skill_result',
      skill: 'canvas.create_nodes',
      outputs,
      content: `已生成 ${outputs.length} 个分镜草稿。`,
    }
  }

  private storyboardDraftFromMessage(message: string) {
    const fragments = message
      .split(/[。.!！?？\n]/)
      .map((item) => item.trim())
      .filter(Boolean)
    const seeds = fragments.length ? fragments : [message]
    const count = Math.min(Math.max(seeds.length, 3), 5)
    return Array.from({ length: count }).map((_, index) => {
      const text = seeds[index] || seeds[seeds.length - 1] || message
      return {
        node_type: 'storyboard',
        label: `分镜 ${index + 1}`,
        position: { x: 160 + index * 320, y: 180 },
        data: {
          title: `分镜 ${index + 1}`,
          shotDescription: text,
          prompt: text,
          status: 'draft',
        },
      }
    })
  }

  private patchFromMessage(message: string) {
    const cleaned = message
      .replace(/^(请|帮我|把|将)/, '')
      .replace(/(修改|调整|改成|改为|换成)/g, '')
      .trim()
    return {
      shotDescription: cleaned || message,
      prompt: cleaned || message,
    }
  }
}
