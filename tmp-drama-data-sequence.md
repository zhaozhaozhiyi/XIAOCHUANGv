# 剧情模块数据交互时序图

> 范围：短剧/剧情工作区，包括总览、剧集向导、源稿理解、改编出剧本、故事地图、单集工作台、素材/画布/任务/成片。

```mermaid
sequenceDiagram
autonumber
actor U as 用户
participant FE as Web 剧情前端
participant API as Next /api/v1 代理
participant BE as Nest 控制器
participant AI1 as DramaAiFirstService
participant SG as StoryGraphService
participant WB as Workbench/媒体服务
participant Q as TaskQueue/Worker
participant AI as Agent/AI/媒体服务
database DB as Postgres/Assets/Tasks

U->>FE: 打开 /drama/:id 或 /episodes
FE->>API: GET /dramas/:id/workspace
API->>BE: 转发请求 + Cookie
BE->>DB: 查项目/剧集/角色/场景/分镜/素材/任务/画布
BE->>SG: 有正文时读取故事地图摘要
SG->>DB: 查 story_graph/task/script_hash
BE-->>FE: workspace 聚合数据

FE->>API: GET /dramas/:id/ai-first
BE->>AI1: getAiFirst()
AI1->>DB: 查源稿/源稿健康/分析结果/任务/分集
BE-->>FE: AI-first 状态

opt 导入源稿或从小说模块导入
FE->>API: GET /writings... 或 POST /dramas/:id/source
BE->>AI1: saveSource()
AI1->>DB: 保存 drama_sources，更新 dramas.metadata.ai_first.source_health
AI1-->>FE: source_health + ai_first
end

opt 源稿理解
FE->>API: POST /dramas/:id/source/analyze
BE->>AI1: analyzeSource()
alt 可同步完成
AI1->>AI: 远程 Agent 或本地规则分析
AI-->>AI1: source_analysis
AI1->>DB: 写 source_analysis，标记旧蓝图/正文过期
else 长源稿或异步任务
AI1->>DB: 创建/复用 tasks，写 task_id/status
AI1->>Q: enqueueTask(task_id)
loop 前端轮询
FE->>API: GET /dramas/:id/ai-first
end
Q->>AI1: executeSourceAnalysisTask()
AI1->>AI: 分块理解或远程 Agent
AI1->>DB: 回写 source_chunks/tasks/source_analysis
end
end

opt 改编出剧本
FE->>API: POST /dramas/:id/episode-blueprints
BE->>AI1: generateEpisodeBlueprints()
AI1->>AI: 生成分集蓝图
AI1->>DB: 写 episodes.blueprint_payload 或创建蓝图任务
FE->>API: POST /dramas/:id/pilot-scripts 或 /episodes/:id/generate-script
AI1->>AI: 生成/重写剧集正文
AI1->>DB: 写 episodes.script_content/status/generation_mode
end

opt 故事地图
FE->>API: POST /dramas/:id/story-graph/build
BE->>SG: requestBuild()
SG->>DB: 创建 graph/build task
SG->>Q: enqueue
Q->>SG: 从已生成正文构建图谱
SG->>DB: 写 entities/relations/events/index
loop 查询图谱
FE->>API: GET entities/relations/events/index-status 或 POST search
SG->>DB: 读图谱与检索索引
end
end

opt 单集工作台加载与编辑
FE->>API: GET /dramas/:id、/episodes/:ep/storyboards、characters、scenes、tasks、compose-status、merge
BE->>DB: 读取单集上下文
FE->>API: PUT /episodes/:id 或 PATCH /episodes/:id/blueprint
BE->>DB: 更新正文/蓝图
FE->>API: POST /storyboards 或 PUT/DELETE /storyboards/:id
BE->>DB: 更新分镜与角色/场景绑定表
end

opt 提取角色场景、音色、分镜拆解
FE->>API: POST /ai/runs?stream=1
API->>BE: SSE 透传
BE->>AI: skill runtime 调用工具
AI->>DB: 保存 characters/scenes/storyboards/links
BE-->>FE: SSE status/delta
FE->>API: GET 单集资源刷新
end

opt 封面/镜头图/TTS/视频/合成/成片
FE->>API: POST /images 或 /videos 或 /storyboards/:id/generate-tts 或 /compose/... 或 /merge/...
BE->>WB: 创建媒体/合成任务
WB->>DB: 写 generation/task/storyboard pending 状态
WB->>Q: enqueue
Q->>AI: 调用图片/视频/TTS/合成服务
AI-->>Q: 返回 URL/status
Q->>DB: 回写 assets、storyboards、video_merges、tasks
loop 前端轮询
FE->>API: GET /images/:id、storyboards、compose-status 或 merge-status
end
end

opt 画布、素材、默认设置、任务面板
FE->>API: GET/POST /dramas/:id/canvases
FE->>API: GET/POST /dramas/:id/project-assets
FE->>API: GET/PATCH /dramas/:id/default-settings
FE->>API: GET /dramas/:id/tasks 或 POST /tasks/:id/retry|cancel
BE->>DB: 读写 canvases/assets/asset_links/settings/tasks
BE->>Q: retry 时重新入队，cancel 时更新状态
end
```

## 关键入口

- 前端 API 封装：`apps/web/src/lib/api.ts`
- Next API 代理：`apps/web/src/app/api/v1/[[...path]]/route.ts`
- 工作区聚合接口：`apps/backend/src/modules/dramas/dramas.controller.ts`
- AI-first 源稿理解/蓝图/正文：`apps/backend/src/modules/dramas/drama-ai-first.service.ts`
- 故事地图：`apps/backend/src/modules/dramas/drama-story-graph.service.ts`
- 单集工作台：`apps/web/src/hooks/use-workbench.ts`
- 分镜接口：`apps/backend/src/modules/storyboards/storyboards.controller.ts`
- 合成接口：`apps/backend/src/modules/compose/compose.controller.ts`
- 任务接口：`apps/backend/src/modules/tasks/tasks.controller.ts`
