---
name: character-scene-extractor
description: 角色和场景提取的规范与方法
---

# 角色与场景提取指南

## 角色提取规范

提取的角色信息包含：
- **姓名**：角色全名
- **角色定位**：主角/配角/龙套
- **外貌描写**：性别、年龄、体型、面部特征、发型、着装（300-500字）
- **性格特点**：核心性格标签
- **角色描述**：背景故事和关系

## 场景提取规范

提取的场景/背景信息包含：
- **地点**：具体场所名称
- **时间**：时间段和光线条件
- **氛围**：环境氛围描述
- **提示词**：用于AI图片生成的英文提示词（纯背景，不含人物）

## 道具提取规范

提取的道具信息包含：
- **名称**：道具名
- **类型**：日常/武器/交通/装饰等
- **描述**：外观和用途
- **图片提示词**：用于AI图片生成的英文提示词

## 使用步骤

1. 调用 `read_script_for_extraction` 读取当前集剧本
2. 调用 `read_existing_characters` 查看项目已有角色和当前集已关联角色
3. 调用 `read_existing_scenes` 查看项目已有场景和当前集已关联场景
4. 只提取当前集真实涉及的角色和场景
5. 调用 `save_dedup_characters` 保存角色并自动关联到当前集
6. 调用 `save_dedup_scenes` 保存场景并自动关联到当前集

## 当前集规则

- 目标是补齐"当前集"需要的角色和场景，不是重扫整个项目
- 若角色或场景已在项目中存在但当前集未关联，仍应复用并关联到当前集
- 若项目中已有同名角色或同地点同时间场景，优先复用，不要重复创建

---

## I/O 契约（由 AI Runtime 强制约束）

本 Skill 由 `POST /api/v1/ai/runs` + `apps/backend/src/modules/ai/skill-handlers/extractor.handler.ts` 调度。
handler 在调用 LLM 之前已经从 DB 读出剧本、已有角色与场景、当前集已关联记录，所以你不需要也不应该调用工具读它们。

### 输入

handler 把 SKILL.md 作为 system prompt，并拼装如下结构的 user message：

```
【用户要求】<payload.input.message，默认"提取角色和场景">

【已有角色】<JSON 数组，含 id/name/role，截断到前 200 条>

【已有场景】<JSON 数组，含 id/location/time，截断到前 200 条>

【剧本】<episode.scriptContent 或 episode.content 的前 12000 字>
```

### 输出（必须严格符合）

**只返回一个合法 JSON 对象，不要 Markdown 代码块、不要解释、不要前后缀文字**：

```json
{
  "characters": [
    {
      "name": "角色名（简洁，无空白）",
      "role": "主角/配角/龙套",
      "description": "角色背景简介",
      "appearance": "外形特征",
      "personality": "性格特征"
    }
  ],
  "scenes": [
    {
      "location": "场景地点",
      "time": "时间段",
      "prompt": "20-40 字的中文场景出图提示"
    }
  ]
}
```

规则：

- 只提取本集剧本中真实出现的角色与场景；不要凭背景知识补全未出现的人物
- 同名角色合并为一条；不要给同一角色拆多份
- scenes 按剧本场次头排列；同地点+不同时间视为新场景
- 可参考"已有角色"/"已有场景"做去重，**但不要在输出里包含 id 字段**
- 字段无法判断时填空字符串，**不要省略字段**

如果输出 JSON 无法解析，handler 会自动发起一次修复请求；但请尽量第一次就给合法 JSON，避免双倍延迟。

### 副作用

handler 在拿到 JSON 后会做：

1. 对每个角色：按 `name` 去重，找到则合并字段并关联到 `episode_characters`；找不到则 INSERT `characters` + 关联
2. 对每个场景：按 `location@@time` 去重，找到则关联 `episode_scenes`；找不到则 INSERT `scenes` + 关联
3. 若 AI 调用失败或 JSON 不可解析，handler 切到启发式回退（按对白冒号扫角色、按场次头扫场景），保证至少能给出"最低限度"提取结果
4. INSERT `ai_runs (skill_id='extractor', target_type='episode', target_id=episodeId)`

### SSE 事件

handler 通过 SSE 向前端发送：

- `data: { type: 'status', text: '正在读取剧本、角色和场景...' }`
- `data: { type: 'status', text: '正在使用 AI 提取角色和场景...' }`
- `data: { type: 'status', text: '提取完成：角色新增 N / 合并 M，场景新增 X / 复用 Y' }`
- `data: { type: 'done', tools_called: ['direct_extraction_save'] }`
- 出错：`data: { type: 'error', message: '...' }`
