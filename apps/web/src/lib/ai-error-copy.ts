function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  return String(error || '')
}

export function getAiErrorCopy(error: unknown, fallback = 'AI 调用失败') {
  const raw = getErrorMessage(error).trim()
  const lower = raw.toLowerCase()

  if (!raw) return fallback

  if (lower.includes('drama_ai_first_disabled')) {
    return '短剧 AI-first 主流程开关已关闭。请开启后再使用源稿理解、改编策略和分集蓝图能力。'
  }
  if (lower.includes('drama_ai_first_agent_required')) {
    return '当前操作需要启用文本大模型配置；仅内部联调可开启本地规则演示模式。'
  }
  if (lower.includes('remote_agent_timeout')) {
    return '大模型服务长时间未返回或连接被中断。可以稍后重试，或换用响应更稳定的文本模型。'
  }
  if (lower.includes('story_graph_stale')) {
    return '剧本已变更，故事地图已过期。请先回到“故事地图”步骤重建，再开始分镜制作。'
  }
  if (lower.includes('story_graph_required')) {
    return '正式故事地图尚未就绪。请先完成全剧剧本正文并构建故事地图，再开始分镜制作。'
  }
  if (lower.includes('continuity_run_required')) {
    return '当前分镜已启用镜头连续性。请先在“连续性”中检查条件，再从“生成本集连续视频”开始生产。'
  }
  if (lower.includes('continuity_edit_revision_required')) {
    return '当前分镜已启用连续性生产。请先完成边界审核并确认剪辑版本，再渲染这一集成片。'
  }
  if (lower.includes('continuity_production_run_active')) {
    return '本集连续视频仍在生成中。请先停止本次生成，或等待它完成后再修改镜头交接。'
  }
  if (lower.includes('continuity_production_run_canceled')) {
    return '这次连续视频生成已经停止。请重新检查连续性条件后，明确开始一次新的生成。'
  }
  if (lower.includes('continuity_retry_not_available')) {
    return '当前没有可以安全继续的失败镜头。请刷新生产状态，或重新检查镜头交接后开始新的生成。'
  }
  if (lower.includes('no active text ai config')) {
    return '未找到可用文本模型配置，请先在设置中启用文本 AI 配置后重试。'
  }
  if (lower.includes('no active image ai config')) {
    return '未找到可用图片模型配置，请先在项目默认设定或设置中启用图片 AI 配置后重试。'
  }
  if (lower.includes('no active video ai config')) {
    return '未找到可用视频模型配置，请先在项目默认设定或设置中启用视频 AI 配置后重试。'
  }
  if (lower.includes('no active audio ai config')) {
    return '未找到可用配音模型配置，请先在项目默认设定或设置中启用配音 AI 配置后重试。'
  }
  if (lower.includes('resource download failed') || lower.includes('image_url') && lower.includes('not valid')) {
    return '服务商无法下载参考图。请确认参考图是外网可访问地址，或重新生成/上传参考图后再试。'
  }
  if (
    lower.includes('sensitivecontentdetected')
    || lower.includes('privacyinformation')
    || lower.includes('sensitive')
  ) {
    return '参考图或提示词触发了服务商内容拦截。建议更换参考图，弱化真人隐私特征后重试。'
  }
  if (lower.includes('fetch failed') || lower.includes('network') || lower.includes('timeout')) {
    return 'AI 服务连接或响应超时。请稍后重试；若持续发生，请检查模型服务状态或更换响应更稳定的模型。'
  }
  if (lower.includes('without provider task id') || lower.includes('manual retry required')) {
    return '任务缺少服务商任务号，系统无法安全自动恢复。请在任务中心手动重试，避免重复提交。'
  }
  if (lower.includes('invalid params') || lower.includes('invalidparameter')) {
    return '服务商拒绝了本次参数。请检查参考图数量、图片格式和提示词后重试。'
  }

  return raw || fallback
}

export function getAiErrorDescription(error: unknown) {
  const raw = getErrorMessage(error).trim()
  const friendly = getAiErrorCopy(error)
  if (!raw || raw === friendly) return undefined
  return raw.length > 220 ? `${raw.slice(0, 220)}...` : raw
}
