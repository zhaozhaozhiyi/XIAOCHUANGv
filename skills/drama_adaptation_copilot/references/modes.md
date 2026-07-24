# Modes

本文件定义 `drama_adaptation_copilot` 的模式、输入重点、输出重点和边界。

## 1. `source_analysis`

用途：把小说或长文本源稿转为可操作的项目理解层。

应做：

- 提炼核心冲突、主角目标、反派阻力、世界规则
- 判断章节结构是否适合短剧化
- 标记高风险段落：信息堆积、对白过长、转折无支撑、命名混乱
- 明确哪些结论来自源稿，哪些只是推断

推荐输出字段：

- `source_analysis.summary`
- `source_analysis.core_conflict`
- `source_analysis.character_graph`
- `source_analysis.world_rules`
- `source_analysis.adaptation_risks`
- `source_analysis.must_keep`
- `source_analysis.suggest_trim`

不要：

- 直接写成分集大纲
- 在这一层生成大量正文

## 2. `strategy_generate`

用途：在理解源稿后，让 AI 先提出改编路径，而不是让用户先拍脑袋设参数。

应做：

- 生成 2 到 3 套明显可区分的策略
- 每套策略必须说明：
  - 改编主张
  - 节奏结构
  - 集数建议
  - 风格倾向
  - 风险代价
  - 适合先试播还是直接全量

推荐输出字段：

- `adaptation_brief.id`
- `adaptation_brief.name`
- `adaptation_brief.pitch`
- `adaptation_brief.rhythm_model`
- `adaptation_brief.episode_range`
- `adaptation_brief.style_direction`
- `adaptation_brief.must_keep`
- `adaptation_brief.risks`

不要：

- 只输出一套策略还称之为“比较”
- 用空洞措辞区分策略

## 3. `strategy_select`

用途：帮助用户在已有策略之间做选择。

应做：

- 对策略差异做清晰比较
- 明确推荐哪一套以及为什么
- 若用户已有倾向，给出确认后的后续动作

推荐输出字段：

- `selected_brief_id`
- `selection_reason`
- `tradeoffs`
- `next_step`

不要：

- 未经说明就替用户静默定稿

## 4. `blueprint_generate`

用途：根据已选策略直接生成真实 `Episode` 蓝图。

这里的核心不是“列一个 outline”，而是创建真实分集对象。

每个 episode 蓝图至少应有：

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
- `status = blueprint`

生成原则：

- 每集必须能独立进入后续正文生成
- 全季蓝图应具备节奏递进，不是机械重复
- 标记高风险集数，便于先做试播或重点人工审查

不要：

- 用“冲突升级/继续推进/终局反转”这种重复模板充满整季
- 只生成标题和一句话就宣称蓝图完成

## 5. `blueprint_refine`

用途：修正局部蓝图，而不是轻易把整季推翻。

应做：

- 明确修正范围：单集 / 连续三集 / 全季某弧光
- 保留已确认的节奏主张和角色关系
- 给出修正理由和影响面

不要：

- 以“优化”为名重写整部作品

## 6. `pilot_plan`

用途：决定试播策略。

默认建议：

- `1-3 集试播`

应做：

- 说明为什么选这几集
- 说明试播验证的目标：钩子、角色识别、风格适配、产能成本
- 明确试播后如何决定是否扩大全季

不要：

- 没有理由地默认全季先跑

## 7. `pilot_script_generate`

用途：生成试播正文。

应做：

- 基于已存在的 `episode_blueprint`
- 为每一集输出真实正文，而不是扩写摘要
- 保留本集蓝图里的开场钩子、剧情目标和结尾悬念
- 必要时给出“建议人工先看哪一集”

不要：

- 在没有蓝图的情况下凭空生成整集
- 让试播三集之间风格完全脱节

## 8. `season_script_generate`

用途：在方向验证后做全季批量正文。

应做：

- 说明是全量生成还是补齐剩余集数
- 标记哪些集建议先跳过人工确认
- 明确失败重跑建议

不要：

- 把全季正文生成说成一步到位且无风险

## 9. `production_handoff`

用途：把分集蓝图或正文送入单集工作台。

应做：

- 明确哪些 episode 已具备进入工作台条件
- 区分：
  - 只能看蓝图
  - 可以生成正文
  - 已可进入工作台
- 推荐先进入哪一集、为什么

建议 handoff 字段：

- `episode_id`
- `handoff_level = blueprint|script_ready`
- `recommended_next_skill`
- `handoff_notes`

## 10. `asset_rollup`

用途：从项目层看角色、场景、配音、视频、成片和失败任务。

应做：

- 输出资产概况
- 标记缺口
- 说明哪些资产来自蓝图、哪些来自正文、哪些来自生产阶段

不要：

- 把资产汇总与模型默认值配置混在一起

## 11. `risk_review`

用途：项目级失败复盘、流程复盘和下一步建议。

应做：

- 标记叙事风险
- 标记产能风险
- 标记模型/配置风险
- 说明下一步最值得做的 1 到 3 个动作

不要：

- 只说“可以优化”

## 12. `status_report`

用途：用一句清晰的话告诉项目现在在哪、卡在哪、下一步是什么。

推荐输出：

- 当前阶段
- 已完成产物
- 阻塞点
- 下一步建议
