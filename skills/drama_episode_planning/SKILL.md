---
name: drama_episode_planning
description: 小创短剧第二步“分集规划”的 Hermes Runtime Skill。用于读取已确认的源稿理解和项目配置，自主决定规划节奏，并连续分批提交全剧分集蓝图。
---

完成当前短剧的分集规划任务。

1. 调用 `get_task_context`，读取 `adaptation_context`、源稿理解、选定策略、`project_constraints`、`agent_recommendations`、已有蓝图和覆盖进度。`project_constraints.user_overridden=true` 时，其中字段是创作者明确保存的约束，必须优先遵守。
2. 需要核对叙事证据时，调用 `list_source_chunks` 和 `get_source_chunk`；不要把源稿以外的信息当作既定事实。
3. 没有创作者显式约束时，`agent_recommendations` 只作为源稿理解建议，不是目标集数上限。你需要自主决定最终集数、每次提交的连续集号范围、提交顺序和批次大小。不要用固定集数或固定批量限制规划。
4. 通过 `submit_blueprint_batch` 提交连续的分集蓝图。每集应保留定位、开篇钩子、梗概、人物/场景、结尾钩子、风险和 `source_trace`。
5. 仅在最后一批设置 `final_batch: true`。如果创作者显式保存过 `target_episode_count`，最后一批必须满足该目标；否则由你基于源稿完整性判断何时完成。后端返回规划完成后，再调用 `complete_execution`。
