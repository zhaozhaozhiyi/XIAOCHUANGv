---
name: voice-assigner
description: 角色音色分配原则与音色库
---

# 音色分配指南

## 分配原则

1. **性别匹配**：男性角色用男声，女性角色用女声
2. **年龄匹配**：少年/青年/中年/老年对应不同音色
3. **性格匹配**：
   - 活泼开朗 → 明亮有活力的音色
   - 沉稳内敛 → 低沉稳重的音色
   - 温柔体贴 → 柔和甜美的音色
   - 威严霸气 → 浑厚有力的音色
4. **角色定位**：主角用辨识度高的音色，配角用中性音色

## 使用步骤

1. 调用 `list_voices` 查看可用音色列表
2. 调用 `get_characters` 获取所有角色信息
3. 分析每个角色的性格、年龄、性别等特征
4. 为每个角色调用 `assign_voice` 分配合适的音色
5. 汇总分配结果给用户

---

## I/O 契约（由 AI Runtime 强制约束）

本 Skill 由 `POST /api/v1/ai/runs` + `apps/backend/src/modules/ai/skill-handlers/voice-assigner.handler.ts` 调度。
handler 在调用 LLM 之前已经从 DB 读出当前集已关联角色和当前音频配置下的可用音色（含 `aiVoices` 表或 `fallbackVoicesForConfig` 回退），你无需也不应调用工具。

### 输入

handler 把 SKILL.md 作为 system prompt，并拼装如下 user message：

```
【用户要求】<payload.input.message，默认"分配音色">

【角色列表】<JSON 数组，每条含 id/name/role/description/personality/current_voice>

【可用音色】<JSON 数组，每条含 id/name/gender/language/traits>
```

注意：**只能从"可用音色"的 id 中选；选其他 id 一律被丢弃，回退到启发式分配。**

### 输出（必须严格符合）

**只返回一个合法 JSON 对象，不要 Markdown、不要解释**：

```json
{
  "assignments": [
    {
      "character_id": 1,
      "voice_id": "voice_xxx",
      "reason": "简短的选择理由"
    }
  ]
}
```

规则：

- 必须覆盖所有给定角色，每角色一个音色
- `voice_id` 严格来自"可用音色"列表
- 优先按性别 → 性格 → 年龄气质排序匹配
- 若 `current_voice` 已经合适，可保留并写明 reason
- reason 控制在 30 字以内

### 副作用

handler 在拿到 JSON 后会做：

1. 按 `validCharacterIds`/`validVoiceIds` 过滤 AI 给的 assignments
2. 对未覆盖的角色用启发式分配兜底：先按 gender 池 round-robin，找不到合适池就用所有可用音色
3. `UPDATE characters SET voice_style=<voice_id>, voice_provider=<provider>, voice_sample_url=NULL, updated_at=now() WHERE id=<character_id>`
4. INSERT `ai_runs (skill_id='voice_assigner', target_type='episode', target_id=episodeId)`

清空 voice_sample_url 是有意的：换音色后旧的试听文件已无效，应当让前端在批量生成试听时重新生成。

### SSE 事件

- `data: { type: 'status', text: '正在读取角色与可用音色...' }`
- `data: { type: 'status', text: '正在使用 AI 分配音色...' }` 或 `'AI 分配不可用，切换为规则分配...'`
- `data: { type: 'status', text: '音色分配完成：已更新 N 个角色' }`
- `data: { type: 'done', tools_called: ['direct_voice_assignment'] }`
- 出错：`data: { type: 'error', message: '...' }`

### 失败前提

handler 在以下情况直接抛错（前端 toast 提示）：

- 当前集还没有角色（先跑 extractor）
- 当前没有可用的音频 AI 配置（先在设置中启用）
- 该 provider 下没有任何可用音色（aiVoices 空且 fallbackVoicesForConfig 也为空）
