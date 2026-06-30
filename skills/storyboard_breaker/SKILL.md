---
name: storyboard-breaker
description: 分镜拆解专业规范
---

# 分镜拆解指南

## 拆解原则

每个镜头聚焦**单一动作**，描述要详尽具体。每个镜头时长 10-15 秒。

## 镜头要素

1. **镜头标题**：3-5字概括核心内容（如"噩梦惊醒"）
2. **时间**：具体时分 + 光线描述
3. **地点**：场景完整描述 + 空间布局 + 环境细节
4. **景别**：远景/全景/中景/近景/特写
5. **角度**：平视/仰视/俯视/侧面/背面
6. **运镜**：固定/推镜/拉镜/摇镜/跟镜/移镜
7. **动作**：谁 + 具体怎么做 + 肢体细节 + 表情
8. **对话**：该镜头的完整对话
9. **画面结果**：动作的即时后果 + 视觉细节
10. **氛围**：光线 + 色调 + 声音 + 整体氛围
11. **时长**：每个镜头 10-15 秒
12. **静态画面提示词**：`image_prompt`，用于首帧/尾帧/镜头图片生成
13. **视频提示词**：`video_prompt`，按 3 秒分段的视频生成描述（必填）
14. **配乐提示词**：`bgm_prompt`，描述该镜头适合的配乐风格
15. **音效提示词**：`sound_effect`，描述该镜头关键环境音/动作音
16. **场景关联**：若能匹配已有场景，必须填写 `scene_id`
17. **角色关联**：填写 `character_ids`，绑定当前镜头涉及的 0 到多个角色

## 视频提示词格式

每个镜头必须包含 `video_prompt` 字段，用于驱动 AI 视频生成：

```
0-3秒：<location>咖啡厅</location>，近景，<role>小明</role>低头看手机，表情焦虑。
<n>3-6秒：<location>咖啡厅</location>，全景，门铃响，<role>小红</role>推门走入。
<n>6-9秒：<location>咖啡厅</location>，中景，<role>小红</role>微笑走向小明，坐下。
```

标签说明：
- `<location>地点</location>` — 场景标记
- `<role>角色名</role>` — 角色标记
- `<voice>角色名</voice>` — 画外音/旁白标记
- `<n>` — 时间段分隔符

## 使用步骤

1. 调用 `read_storyboard_context` 读取剧本、角色、场景、已有分镜摘要，以及剧集的 `drama.style` 和 `style_hint`
2. 先基于剧本完成镜头拆解，确保总时长和叙事连续性合理
3. 为每个镜头补全完整字段：`title / shot_type / angle / movement / location / time / character_ids / action / dialogue / description / result / atmosphere / image_prompt / video_prompt / bgm_prompt / sound_effect / duration / scene_id`
4. **整集保持视觉风格统一**：在生成 `image_prompt` 和 `video_prompt` 时，**末尾统一拼接 context 返回的 `style_hint`**（英文风格词串），不要自己另造风格描述
5. 调用 `save_storyboards` 一次性保存完整分镜
6. 如需调整，调用 `update_storyboard` 修改具体镜头

## 视觉风格规范

- `drama.style` 是整集共享的风格锚点，可能是 `realistic / anime / ghibli / cinematic / comic / watercolor` 之一
- `style_hint` 是与该 style 对应的英文提示词片段（由系统生成），例如 anime 对应 "anime style, japanese 2D illustration, cel shading, ..."
- 不要自己在 prompt 中写死"写实风格"这类中文风格词；统一使用 `style_hint`
- 如果 `drama.style = realistic`，清楚地让画面写实、但**避免描述"清晰的真人正面肖像"**以降低平台真人检测命中率；可以使用侧脸、背影、特写局部、剪影、环境为主的构图

## 场景关联规则

- 优先使用 `read_storyboard_context` 返回的 `scenes`
- `location + time` 可明确匹配时，必须回填正确 `scene_id`
- 不要凭空生成不存在的场景 ID
- 如果剧本内容明显落在已有场景中，不要重复创造新场景描述

## 角色绑定规则

- `character_ids` 必须从 `read_storyboard_context` 返回的角色列表中选择
- 一个镜头可以没有角色，也可以绑定多个角色
- 只要镜头里有明确出场、被看见、发生动作或说话的角色，都应绑定进去
- 纯环境镜头、空镜头、物件镜头可以传空数组

## 质量要求

- `description` 要适合人读，`video_prompt` 要适合模型生成，二者不要互相替代
- `image_prompt` 要突出单帧构图、角色外观、环境和光线
- `video_prompt` 要突出时间推进、动作变化、镜头语言
- `bgm_prompt` 和 `sound_effect` 用简洁短语即可，但不能空泛到只有"紧张""悲伤"
- 若存在旁白，统一写入 `dialogue`，格式为 `旁白：内容`

---

## I/O 契约（由 AI Runtime 强制约束）

本 Skill 由 `POST /api/v1/ai/runs` + `apps/backend/src/modules/ai/skill-handlers/storyboard-breaker.handler.ts` 调度。
handler 在调用 LLM 之前已经从 DB 读出 episode/drama/script/style_hint/characters/scenes/existing_storyboards，并裁断 script 到 8000 字。你无需也不应调用工具读它们。

### 输入

handler 把 SKILL.md 作为 system prompt，并拼装如下 user message：

```
【用户要求】<payload.input.message，默认"拆解分镜">

【上下文】<JSON 对象，结构如下，script 已截断到 8000 字>
{
  "episode": { "id", "title", "episode_number", "description" },
  "drama": { "id", "title", "style" },
  "style_hint": "<英文风格词串>",
  "script": "<格式化剧本前 8000 字>",
  "characters": [ { "id", "name", "role", "description", "appearance", "personality" } ],
  "scenes":     [ { "id", "location", "time", "prompt" } ],
  "existing_storyboards": [ { "id", "shot_number", "title", "scene_id", "shot_type", "duration" } ]
}
```

### 输出（必须严格符合）

**只返回一个合法 JSON 对象，不要 Markdown、不要解释**：

```json
{
  "storyboards": [
    {
      "shot_number": 1,
      "title": "镜头标题（3-8 字）",
      "shot_type": "近景/中景/全景/特写等",
      "angle": "拍摄角度",
      "movement": "镜头运动",
      "location": "地点",
      "time": "时间",
      "action": "动作描述",
      "dialogue": "对白，没有则空字符串",
      "description": "画面描述",
      "result": "剧情结果",
      "atmosphere": "情绪氛围",
      "image_prompt": "英文图像提示词，包含人物、场景、画面，末尾必须拼 style_hint",
      "video_prompt": "按 3 秒分段，使用 <location>/<role>/<voice>/<n> 标记",
      "bgm_prompt": "配乐风格短语",
      "sound_effect": "音效短语",
      "duration": 10,
      "scene_id": null,
      "character_ids": []
    }
  ]
}
```

硬约束：

- `storyboards` **至少 1 条**，空数组会被 handler 拒绝（throw "未生成有效分镜"）
- 每条**必须**有非空的 `description` 或 `action`，二者全空会被拒绝
- `scene_id` 只能用上下文 `scenes` 中的 id；无匹配传 `null`，**不要乱编**
- `character_ids` 只能用上下文 `characters` 中的 id；不属于当前集的角色 id 会被拒绝
- `image_prompt` 必须包含上下文 `style_hint` 的英文风格词串
- `shot_number` 从 1 连续递增

### 副作用

handler 在拿到合法 JSON 后会做：

1. 对每个 storyboard 调用 `autoFillStoryboardDefaults` 自动补齐空字段（title 默认 "镜头 N"、bgm_prompt 默认 "轻柔背景音乐" 等），但你**不应依赖兜底**
2. 校验 scene_id / character_ids 归属，命中非法 id 直接报错（不会落库部分数据）
3. `DELETE FROM storyboards WHERE episode_id=?` + `DELETE FROM storyboard_characters WHERE storyboard_id IN ...`，整集重建
4. 批量 INSERT `storyboards`，同步 `storyboard_characters`
5. `UPDATE episodes SET duration=ceil(总秒数/60), updated_at=now()`
6. INSERT `ai_runs (skill_id='storyboard_breaker', target_type='episode', target_id=episodeId)`

### SSE 事件

- `data: { type: 'status', text: '正在读取剧本、角色和场景...' }`
- `data: { type: 'status', text: '正在生成并保存分镜...' }`
- `data: { type: 'status', text: '分镜已保存：N 条' }`
- `data: { type: 'done', tools_called: ['backend_json_storyboard_save'] }`
- 出错：`data: { type: 'error', message: '...' }`（前端会重试或提示用户手动检查 JSON）
