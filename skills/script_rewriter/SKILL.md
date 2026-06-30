---
name: script-rewriter
description: 小说改写为格式化剧本的方法论和规范
---

# 剧本改写指南

## 改写原则

1. **保留核心情节**：不改变主线故事和角色关系
2. **增强画面感**：将叙述性文字转化为可视化的场景描写
3. **对话驱动**：用对白推动情节，减少旁白
4. **节奏把控**：每场戏控制在 30-60 秒，适合短视频
5. **不写镜头语言**：不涉及景别、角度、运镜，这些属于分镜拆解步骤

## 格式化剧本格式

```
## S01 | 内景 · 咖啡厅 | 黄昏

黄昏的光线透过落地窗洒进咖啡厅，吧台上咖啡杯热气升腾。

小明独自坐在角落卡座，低头看手机，神情有些焦虑。

门铃响起，小红推门而入。她看到小明，微笑着走过去。

小红：（微笑）等很久了吗？
小明：（抬头）还好，刚到。
```

### 格式规则

- `## S编号 | 内景/外景 · 地点 | 时间段` — 场景头
- 动作描写自然段 — 不包含任何镜头语言
- `角色名：（状态/表情）台词内容` — 对白格式

### 内容量参考

格式化剧本相比原始内容增加约 20-30%，主要增量是场景头标记和对白格式化，不是扩写。

## 改写步骤

1. 先调用 `read_episode_script` 读取原始内容
2. 分析内容结构（对话、叙述、心理描写的比例）
3. 调用 `rewrite_to_screenplay` 执行改写
4. 检查改写结果，确认符合格式化剧本格式
5. 调用 `save_script` 保存最终结果

## 注意事项

- 心理描写可转化为角色表情/动作或画外音
- 长段叙述拆分为多个短场景
- 确保每个场景有明确的情绪转折点
- 保持角色语言风格一致性
- 场景编号连续递增（S01, S02, S03...）
- 时间段要具体（黄昏、深夜、清晨），不要笼统写"白天"

---

## I/O 契约（由 AI Runtime 强制约束）

本 Skill 由 `POST /api/v1/ai/runs` + `apps/backend/src/modules/ai/skill-handlers/script-rewriter.handler.ts` 调度。
直接 fetch chat/completions 调用此 Skill 视为违例（`verify:skill-driven` 静态门禁会拒）。

### 输入

由 handler 拼装为单条 user message，结构稳定，便于模型抓取：

```
【原始剧本】
<episode.content 或 episode.scriptContent，handler 直接读 DB，不依赖前端>

【用户要求】
<payload.input.message，默认"改写以下内容">
```

handler 同时通过 system prompt 注入本 SKILL.md 全文，前端不要在 input.message 里再重复格式规则。

### 输出

**直接输出格式化剧本正文，纯文本，不要代码块、不要解释、不要前言后记**。
handler 会从你的输出里抓取第一个 `## S\d+` 之后的所有内容作为剧本主体，所以：

- 第一行必须从场次头 `## S01 | ...` 开始（前面的引导词会被丢弃）
- 不要写"以下是改写结果"、"```"、"已为你改写完成" 等寒暄
- 不要输出 Markdown 标题（如 `# 改写结果`），场次头本身就是结构

### 副作用

handler 在流式接收完毕后会执行：

- `UPDATE episodes SET scriptContent = <清洗后的剧本>, updatedAt = now() WHERE id = episodeId`
- `INSERT INTO ai_runs (skill_id='script_rewriter', mode, scene, target_type='episode', target_id=episodeId, ...)`

### SSE 事件流

handler 通过 SSE 向前端发送：

- `data: { type: 'status', text: '正在改写剧本...' }`
- `data: { type: 'delta', text: '<增量文本>' }`（首个分片之前会跳过引导词，确保从 `## S` 开始）
- `data: { type: 'done', tools_called: ['direct_script_rewrite'] }`
- 出错：`data: { type: 'error', message: '...' }`
