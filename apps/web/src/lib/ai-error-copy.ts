function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  return String(error || '')
}

export function getAiErrorCopy(error: unknown, fallback = 'AI 调用失败') {
  const raw = getErrorMessage(error).trim()
  const lower = raw.toLowerCase()

  if (!raw) return fallback

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
    return 'AI 服务连接或轮询超时。请确认后端、Redis/队列 Worker 和媒体存储已启动，再稍后重试。'
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
