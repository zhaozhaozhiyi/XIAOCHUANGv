import fs from 'node:fs'

const checks = []
function checkFile(path, expectations) {
  const content = fs.readFileSync(path, 'utf8')
  for (const [label, pattern] of expectations) {
    const ok = typeof pattern === 'string' ? content.includes(pattern) : pattern.test(content)
    checks.push({ path, label, ok })
  }
}
function checkAbsent(path, label) {
  checks.push({ path, label, ok: !fs.existsSync(path) })
}

checkFile('apps/backend/src/modules/ai/ai.controller.ts', [
  ['ai controller exists', "@Controller('ai')"],
  ['ai runs stream route exists', "@Post('runs')"],
  ['ai list runs endpoint exists', "@Get('runs')"],
  ['ai result action apply endpoint exists', "@Post('result-actions/:runId/apply')"],
  ['skill_id accepted', 'skill_id: z.string().min(1)'],
  ['mode query accepted', 'mode: z.string().min(1).optional()'],
  ['selection input accepted', 'selection: z.string().nullable().optional()'],
])

checkFile('packages/contracts/src/shared.ts', [
  ['AI runtime action contract exists', 'export interface AiRuntimeActionItem'],
  ['AI runtime reference contract exists', 'export interface AiRuntimeReferenceItem'],
  ['AI runtime run record uses typed actions', 'actions?: AiRuntimeActionItem[]'],
  ['AI runtime run record uses typed references', 'references?: AiRuntimeReferenceItem[]'],
  ['AI runtime apply response uses JsonObjectPayload', 'structured?: JsonObjectPayload | null'],
])

checkFile('apps/backend/src/modules/ai/ai.service.ts', [
  ['AI service imports runtime action contracts', 'AiRuntimeActionItem, AiRuntimeApplyResultPayload, AiRuntimeReferenceItem, JsonObjectPayload'],
  ['AI service parses typed run actions', 'safeJsonParse<AiRuntimeActionItem[]>'],
  ['AI service parses typed run references', 'safeJsonParse<AiRuntimeReferenceItem[]>'],
  ['AI service marks typed action results', 'result: AiRuntimeApplyResultPayload'],
  ['AI service avoids unknown action candidates', /^(?![\s\S]*actionCandidates: unknown\[\])[\s\S]*$/],
  ['skill prompt loader exists', 'loadSkillPrompt'],
  ['writing context resolver exists', "payload.target?.type !== 'writing'"],
  ['mode-specific context budget exists', 'function getContextBudget(mode: string)'],
  ['knowledge cards are ranked by mode', 'rankKnowledgeCards(knowledgeCards, mode)'],
  ['selection enters context budget', "const selection = typeof payload.input?.selection === 'string'"],
  ['stream emits references', "type: 'reference'"],
  ['runs persist assistant text', 'assistantMessage: assistantText'],
  ['runs persist references', 'referencesJson: JSON.stringify(context.references || [])'],
  ['runs list supports mode filter', 'if (mode) filters.push(eq(aiRuns.mode, mode))'],
  ['applied action result is persisted', 'apply_result: result'],
  ['create draft action supported', "action.type === 'create_document_draft'"],
  ['append document action supported', "action.type === 'append_document'"],
  ['update brief action supported', "action.type === 'update_brief'"],
  ['write outline action supported', "action.type === 'write_outline'"],
  ['write summary action supported', "action.type === 'write_summary'"],
  ['create proposal action supported', "action.type === 'create_proposal'"],
  ['replace selection stays proposal-first', "proposalKind: 'replace_selection'"],
  ['knowledge card action supported', "action.type === 'knowledge_card' || action.type === 'create_knowledge_card'"],
])

checkFile('skills/writing_copilot/SKILL.md', [
  ['writing skill defines chapter_write', '## `chapter_write`'],
  ['writing skill defines consistency check', '## `consistency_check`'],
  ['writing skill includes action schema', '"actions": ['],
])

checkFile('apps/web/src/components/writing/writing-chat-panel.tsx', [
  ['chat panel uses ai runs stream', '/api/v1/ai/runs?stream=1'],
  ['chat panel sends writing copilot skill', "skill_id: 'writing_copilot'"],
  ['chat panel loads ai history', 'aiRuntimeAPI.listRuns'],
  ['history supports current mode filter', "historyModeFilter === 'current' ? mode : undefined"],
  ['older history uses before_id', 'before_id: oldestRunId'],
  ['chat panel can apply action', 'aiRuntimeAPI.applyAction'],
  ['action apply disables repeated clicks', 'applyingActionKey != null'],
  ['current references render kind labels', 'getReferenceLabel(reference.kind)'],
  ['current references render reasons', 'reference.reason'],
  ['history references render', '历史参考'],
  ['history loading state renders', '正在加载 AI 历史'],
  ['history retry renders', '重试'],
  ['empty history state renders', '暂无 AI 历史'],
  ['selection preview renders', '已带入选区'],
  ['selection can be refreshed', '刷新选区状态'],
  ['create proposal callback used', 'onProposalCreated?.(result.proposal_id)'],
  ['knowledge card callback used', 'onKnowledgeCardCreated?.(result.knowledge_card_id)'],
])

checkFile('apps/web/src/app/(default)/(protected)/writing/[id]/page.tsx', [
  ['workspace passes writing id to chat panel', 'writingId={writingId}'],
  ['workspace passes document id to chat panel', 'documentId={activeDocId}'],
  ['workspace passes editor selection to chat panel', 'getSelection={getEditorSelection}'],
  ['workspace refreshes after AI reload', 'onReloadRequested={() => { void loadDetail(); void refreshProposals(); void refreshExecutions(); if (activeDocId != null) void loadDocument(activeDocId) }}'],
])

checkFile('apps/backend/src/modules/ai/ai.service.ts', [
  ['extractor bridge payload is supported', "skillId: String(payload.skill_id || '')"],
  ['storyboard breaker skill prompt exists', "path.join(repoRoot(), 'skills', skillId.replace(/_/g, '-'), 'SKILL.md')"],
  ['voice assigner skill id can be loaded', 'loadSkillPrompt(payload.skill_id)'],
  ['grid prompt generator skill id can be loaded', "skillId: String(payload.skill_id || '')"],
])

checkFile('apps/web/src/hooks/use-workbench.ts', [
  ['runAgentStream uses unified ai runs endpoint', "url: '/api/v1/ai/runs?stream=1'"],
  ['workbench dispatcher registers extractor', "extractor:              { skill_id: 'extractor',              mode: 'extract'"],
  ['workbench dispatcher registers storyboard_breaker', "storyboard_breaker:     { skill_id: 'storyboard_breaker',     mode: 'breakdown'"],
  ['workbench dispatcher registers voice_assigner', "voice_assigner:         { skill_id: 'voice_assigner',         mode: 'assign'"],
  ['workbench dispatcher registers grid_prompt_generator', "grid_prompt_generator:  { skill_id: 'grid_prompt_generator',  mode: 'grid_prompt'"],
  ['workbench dispatcher registers script_rewriter', "script_rewriter:        { skill_id: 'script_rewriter',        mode: 'rewrite'"],
])

checkFile('apps/web/src/hooks/use-grid-tool.ts', [
  ['grid tool uses ai runs', '/api/v1/ai/runs?stream=1'],
  ['grid tool sends unified skill payload', "skill_id: 'grid_prompt_generator'"],
])

// agents.controller.ts and agents.service.ts were removed in T5 of the
// skill-driven AI runtime closeup. The agents/ folder now only retains
// agents.ai.ts (getTextConfig — shared with writing-agent), agents.storyboard.ts
// (readStoryboardContext + saveStoryboardsForEpisode — used by the
// storyboard_breaker handler), and agents.types.ts (StoryboardSaveInput type).
checkFile('apps/backend/src/modules/agents/agents.ai.ts', [
  ['getTextConfig helper still exported', 'export async function getTextConfig'],
  ['getTextProviderBaseUrl helper still exported', 'export function getTextProviderBaseUrl'],
])
checkFile('apps/backend/src/modules/agents/agents.storyboard.ts', [
  ['readStoryboardContext still exported', 'export async function readStoryboardContext'],
  ['saveStoryboardsForEpisode still exported', 'export async function saveStoryboardsForEpisode'],
])
checkAbsent('apps/backend/src/modules/agents/agents.controller.ts', 'agents.controller.ts removed')
checkAbsent('apps/backend/src/modules/agents/agents.service.ts', 'agents.service.ts removed')
checkAbsent('apps/backend/src/modules/agents/agents.module.ts', 'agents.module.ts removed')

const failed = checks.filter((item) => !item.ok)
for (const item of checks) {
  console.log((item.ok ? 'PASS' : 'FAIL') + ' ' + item.label + ' (' + item.path + ')')
}
if (failed.length) process.exitCode = 1
