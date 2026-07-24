# Output Contract

`drama_adaptation_copilot` 优先输出结构化 JSON。

## 1. 顶层结构

```json
{
  "answer": "给用户展示的主要结论",
  "artifacts": [],
  "references": [],
  "actions": [],
  "warnings": []
}
```

## 2. 顶层字段

### `answer`

必填。用简洁语言说明：

- 当前结论
- 当前阶段
- 下一步建议

### `artifacts`

可选。表示本次 AI 真正产出的项目级对象。

### `references`

可选。表示本次判断参考了哪些对象。

### `actions`

可选。表示后续系统或人工可执行动作。

### `warnings`

可选。用于输出风险、不确定性和人工确认点。

## 3. Artifact 结构

```json
{
  "type": "source_analysis|adaptation_brief|episode_blueprint|episode_script_batch|production_handoff|asset_rollup|risk_report|status_report",
  "id": "artifact-id",
  "title": "产物标题",
  "status": "draft|ready|selected|queued|blocked",
  "certainty": "confirmed|extracted|inferred|to_confirm",
  "payload": {}
}
```

## 4. 推荐 artifact 类型

### `source_analysis`

`payload` 推荐字段：

- `summary`
- `core_conflict`
- `character_graph`
- `world_rules`
- `adaptation_risks`
- `must_keep`
- `suggest_trim`

### `adaptation_brief`

- `name`
- `pitch`
- `rhythm_model`
- `episode_range`
- `style_direction`
- `must_keep`
- `risks`
- `recommended_batch_strategy`

### `episode_blueprint`

- `episode_number`
- `title`
- `positioning`
- `opening_hook`
- `summary`
- `source_trace`
- `characters`
- `scenes`
- `ending_hook`
- `risks`

### `episode_script_batch`

- `scope`
- `episodes`
- `generation_notes`
- `review_focus`

### `production_handoff`

- `episode_ids`
- `handoff_level`
- `recommended_next_step`
- `notes`

### `asset_rollup`

- `characters_ready`
- `scenes_ready`
- `audio_ready`
- `videos_ready`
- `composed_ready`
- `gaps`

### `risk_report`

- `narrative_risks`
- `production_risks`
- `runtime_risks`
- `recommended_actions`

### `status_report`

- `current_stage`
- `done`
- `blocked_by`
- `next_step`

## 5. Reference 结构

```json
{
  "kind": "project|source_analysis|brief|episode|asset|history",
  "title": "引用对象标题",
  "reason": "为什么参考了它"
}
```

## 6. Action 结构

```json
{
  "type": "save_source_analysis|create_brief_candidates|select_brief_candidate|upsert_episode_blueprints|queue_pilot_scripts|queue_season_scripts|open_episode_workbench|refresh_asset_rollup|create_risk_report|update_project_status",
  "label": "给用户看的操作名",
  "payload": {}
}
```

## 7. 推荐 action 类型

- `save_source_analysis`
- `create_brief_candidates`
- `select_brief_candidate`
- `upsert_episode_blueprints`
- `queue_pilot_scripts`
- `queue_season_scripts`
- `open_episode_workbench`
- `refresh_asset_rollup`
- `create_risk_report`
- `update_project_status`

## 8. Warning 结构

```json
{
  "level": "info|warn|critical",
  "message": "风险说明",
  "needs_confirmation": true
}
```

## 9. 输出纪律

### 必须做到

- `answer` 中直接说清结论
- `artifacts` 只放真实产物，不放空壳
- `certainty` 要诚实
- `warnings` 要标记需要人工确认的地方

### 不要这样做

- 把纯参数保存写成 artifact
- 把重复模板的 outline 说成 episode blueprint 已完成
- 没有依据时把 `certainty` 标成 `confirmed`
