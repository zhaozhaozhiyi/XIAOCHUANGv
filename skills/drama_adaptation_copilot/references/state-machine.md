# State Machine

本文件定义项目和分集的推荐状态机，以及默认批量策略。

## 1. Drama 状态

推荐项目状态：

- `source_pending`
- `source_ready`
- `analysis_ready`
- `brief_pending`
- `brief_selected`
- `blueprint_generating`
- `blueprint_ready`
- `pilot_pending`
- `pilot_generating`
- `pilot_reviewing`
- `season_generating`
- `in_production`
- `deliverable_ready`
- `blocked`

### 常见转换

- `source_pending -> source_ready`
- `source_ready -> analysis_ready`
- `analysis_ready -> brief_selected`
- `brief_selected -> blueprint_ready`
- `blueprint_ready -> pilot_pending`
- `pilot_pending -> pilot_generating`
- `pilot_generating -> pilot_reviewing`
- `pilot_reviewing -> season_generating`
- `season_generating -> in_production`
- `in_production -> deliverable_ready`

### 阻塞态

以下情况可进入 `blocked`：

- 源稿结构异常，无法可靠解析
- 策略未选定但用户要求直接全量生成
- 大量试播集方向不成立
- 关键模型或资产能力缺失，无法继续生产

## 2. Episode 状态

推荐单集状态：

- `blueprint`
- `script_generating`
- `script_ready`
- `storyboard_ready`
- `asset_ready`
- `composed`
- `failed`

### 含义

- `blueprint`
  - 已有本集定位、摘要、角色、场景、风险
  - 还没有真实正文

- `script_generating`
  - 正在批量或单集生成正文

- `script_ready`
  - 本集正文已可进入单集工作台

- `storyboard_ready`
  - 已完成分镜拆解

- `asset_ready`
  - 场景图、配音、镜头图、视频已基本就绪

- `composed`
  - 已完成合成或项目定义的出片状态

- `failed`
  - 在某一生成步骤失败，需要重跑或人工修正

## 3. 推荐动作与状态映射

### 项目级

- `source_ready` 时可做：`source_analysis`
- `analysis_ready` 时可做：`strategy_generate`
- `brief_selected` 时可做：`blueprint_generate`
- `blueprint_ready` 时可做：`pilot_plan`
- `pilot_reviewing` 通过后可做：`season_script_generate`

### 单集级

- `blueprint` 时可做：`generate_script`
- `script_ready` 时可做：`open_workbench`
- `failed` 时可做：`retry_failed_step`

## 4. 批量策略

默认批量策略：

1. 先生成全季蓝图
2. 先做 1 到 3 集试播正文
3. 人工确认方向
4. 再批量生成剩余正文

## 5. 为什么默认试播优先

- 先验证角色成立与否
- 先验证钩子节奏是否够强
- 先验证模型是否适配风格
- 先验证单集工作台的后半段是否能顺利承接

## 6. 什么时候允许直接全季正文

只有在以下条件同时满足时才建议：

- 源稿健康
- 策略已明确
- 蓝图质量稳定
- 用户明确接受较高返工成本
- 项目目标是快速产出而不是精修试播

## 7. 绝不推荐的情况

- 没有源稿理解就直接全季
- 没有策略比较就直接全季
- 蓝图都没有就直接把 outline 当成 episode
- 用模型默认值页面替代叙事决策
