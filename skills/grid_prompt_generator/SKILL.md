---
name: grid-image-generator
description: 图片提示词生成指南 — 角色、场景、宫格图三类提示词规范
---

# 图片提示词生成指南

本 SKILL 对应 `grid_prompt_generator` 入口，支持生成三类图片提示词：

1. **角色图片提示词** — 角色外貌与气质
2. **场景图片提示词** — 场景氛围与光线
3. **宫格图提示词** — 多镜头网格拼图

详细模板见 `reference/` 目录。

---

## ⚠️ 重要：本 Skill **不调用 LLM**

`grid_prompt_generator` 是一个 **backend-tool-only** skill，由 `apps/backend/src/modules/ai/skill-handlers/grid-prompt.handler.ts` 完成全部计算：

- handler 直接调 `GridService.buildGridPromptPayload(...)`，基于分镜的 `image_prompt` 字段、参考素材、`drama.style` 在纯代码里拼装宫格提示词
- 不发任何 `chat/completions` 请求，不产生 token 消耗
- handler 仍然把本 SKILL.md 作为约束文档加载到 SkillHandlerContext，**但当前未使用**；保留是为了未来若需要切换到 LLM 重排可以无缝注入

本 SKILL.md 的内容主要面向：
- 人类工程师：理解宫格提示词的设计原则，便于评估代码生成结果或手动改写
- 未来可能的 LLM 重排：若决定让 AI 优化纯代码拼装的 prompt，约束已经在这里

## 视觉风格统一

所有提示词都应尊重 **drama 级别的视觉风格**（`drama.style`）：`realistic / anime / ghibli / cinematic / comic / watercolor`。

- `generate_character_prompt`、`generate_scene_prompt`、`generate_grid_prompt` 这几个工具已经**内置风格片段**，会自动把当前 drama 的 style hint 拼到返回的 prompt 里，无需手动再写风格词
- 下游的 `POST /api/v1/images` 与 `POST /api/v1/videos` 也会在生成最终 prompt 前自动追加风格 hint，做最后兜底
- 因此 Agent 在自行拼 prompt 时，**不要再写死中文"写实风格 / 动漫风格"**，统一把风格控制权交给系统

---

## 角色图片提示词

参考：`reference/character-prompt.md`

### 模板结构
```
[appearance], [personality/temperament], [role], [cinematic portrait], [high quality], [consistent art style], [no text, no watermark]
```

### 生成规则
- 以 `appearance`（外貌描述）为核心
- `personality` 决定气质基调（内敛/张扬/神秘等）
- `role` 决定服装和道具风格
- 必须包含 `cinematic portrait` + `consistent art style`
- 避免出现文字、签名、水印

---

## 场景图片提示词

参考：`reference/scene-prompt.md`

### 模板结构
```
[location], [time period], [lighting atmosphere], [scene description], [cinematic scene], [high quality], [consistent art style], [no text, no watermark]
```

### 生成规则
- 以 `location`（地点）为基础
- `time` 决定光线色调（白天/夜晚/黄昏）
- 场景氛围词：atmospheric, moody, warm, cold 等
- 必须包含 `cinematic scene` + `consistent art style`
- 避免出现文字、签名、水印

---

## 宫格图提示词

参考：`reference/shot-prompt.md`

### 三种模式

#### 首帧模式 (first_frame)
每个格子 = 一个镜头的起始画面，但必须严格生成用户指定的 `rows x cols` 总格数。

```
[rows x cols grid layout], exactly [rows*cols] visible panels, consistent art style, [style description],
格1: [shot 1 opening scene],
格2: [shot 2 opening scene],
格3: [shot 3 opening scene],
...
格N: [opening scene],
high quality, cinematic lighting, no merged panels, no missing panels, no text, no watermark
```

#### 首尾帧模式 (first_last)
保持首尾帧节奏感，但仍然必须严格生成用户指定的 `rows x cols` 总格数，不允许偷偷改成 `Nx2`。

```
[rows x cols grid layout], exactly [rows*cols] visible panels, consistent art style, [style description],
格1: [opening beat],
格2: [closing beat],
格3: [opening beat],
格4: [closing beat],
...
high quality, cinematic, continuous motion implied, no merged panels, no missing panels, no text
```

#### 多参考模式 (multi_ref)
所有格子都是同一镜头的不同角度/构图参考，但仍然必须严格生成用户指定的 `rows x cols` 总格数。

```
[rows x cols grid layout], exactly [rows*cols] visible panels, same scene different angles, [style description],
[main scene description],
格1: wide shot establishing,
格2: medium shot character focus,
格3: close-up detail,
格4: dramatic angle,
...
consistent lighting and color palette, no merged panels, no missing panels, no text
```

### 通用规则
1. 提示词使用**英文**
2. 必须明确写出用户指定的 `rows x cols grid layout`
3. 必须包含 `consistent art style` 保持风格统一
4. 必须明确要求 `exactly N visible panels`
5. 必须明确要求 `no merged panels, no missing panels`
6. 避免在格子间出现分割线的描述
7. 尺寸建议：每格 960x540，总图 = 960×cols × 540×rows
8. 当存在参考图映射时，统一使用 `图片1/图片2/...` 指代参考图，不要把它和 `格1/格2/...` 混用


---

## I/O 契约（由 AI Runtime 强制约束）

本 Skill 由 `POST /api/v1/ai/runs` + `apps/backend/src/modules/ai/skill-handlers/grid-prompt.handler.ts` 调度。

### 输入

前端通过 `input` 子字段传入参数（不再通过 query / 多个 path param）：

```json
{
  "skill_id": "grid_prompt_generator",
  "mode": "grid_prompt",
  "scene": "grid_tool",
  "target": { "type": "episode", "drama_id": 123, "episode_id": 456 },
  "input": {
    "message": "生成宫格提示词",
    "storyboard_ids": [1, 2, 3, 4],
    "rows": 2,
    "cols": 2,
    "mode": "continuous_motion"
  },
  "options": { "stream": true }
}
```

### 输出

handler 通过 SSE 返回，并把全部结果挂在 `done` 事件的 `payload` 上：

```json
{
  "type": "done",
  "payload": {
    "grid_prompt": "<英文宫格 prompt>",
    "cell_prompts": [ { "index": 0, "prompt": "..." }, ... ],
    "source": "fallback",
    "grid": { "rows": 2, "cols": 2 },
    "storyboard_ids": [1, 2, 3, 4],
    "mode": "continuous_motion"
  },
  "tools_called": ["backend_grid_prompt_payload"]
}
```

### 副作用

- INSERT `ai_runs (skill_id='grid_prompt_generator', target_type='episode', target_id=episodeId, assistantMessage=<grid_prompt 截断>)`
- 不写其他业务表（宫格 prompt 由前端拿到后再触发 `POST /api/v1/images/grid` 生成图片）

### SSE 事件

- `data: { type: 'status', text: '正在读取分镜与参考素材...' }`
- `data: { type: 'status', text: '宫格提示词已生成' }`
- `data: { type: 'done', payload: {...}, tools_called: ['backend_grid_prompt_payload'] }`
- 出错：`data: { type: 'error', message: '...' }`
