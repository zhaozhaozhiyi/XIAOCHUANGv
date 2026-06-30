import fs from 'node:fs'

const checks = []
function checkFile(path, expectations) {
  const content = fs.readFileSync(path, 'utf8')
  for (const [label, pattern] of expectations) {
    const ok = typeof pattern === 'string' ? content.includes(pattern) : pattern.test(content)
    checks.push({ path, label, ok })
  }
}

checkFile('apps/web/src/app/(default)/(protected)/writing/page.tsx', [
  ['uses card grid instead of table', 'grid gap-4 md:grid-cols-2 xl:grid-cols-3'],
  ['does not render table view', /<table\b/.test(fs.readFileSync('apps/web/src/app/(default)/(protected)/writing/page.tsx', 'utf8')) ? /^$/ : /./],
  ['create dialog includes creative brief skip copy', '创作准备可先跳过'],
  ['create request sends brief_json', 'brief_json: buildBriefJson'],
  ['empty state has primary create action', '暂无作品'],
])

checkFile('apps/web/src/app/(default)/(protected)/writing/[id]/page.tsx', [
  ['workspace root exists', 'writing-workspace'],
  ['workspace uses viewport height', 'h-[calc(100vh-96px)]'],
  ['creative brief panel exists', '创作准备'],
  ['dirty state includes brief', 'dirty || briefDirty'],
  ['save writes brief_json', 'brief_json: stringifyBrief(brief)'],
  ['markdown export remains available', '导出 Markdown'],
])

checkFile('apps/backend/src/db/schema.ts', [
  ['writings has briefJson column', "briefJson: text('brief_json')"],
])

checkFile('apps/backend/src/modules/writings/writings.controller.ts', [
  ['create accepts brief_json', 'brief_json: z.string().nullable().optional()'],
  ['detail returns brief_json', 'brief_json: writing.briefJson'],
  ['patch saves brief_json', 'updates.briefJson = payload.brief_json'],
])

checkFile('packages/contracts/src/shared.ts', [
  ['contract exposes brief_json', 'brief_json: string | null'],
])

checkFile('apps/web/src/components/writing/writing-chat-panel.tsx', [
  ['agent panel has stable final output state', 'lastGeneratedContent'],
  ['agent result can be inserted after stream completes', '追加到正文'],
  ['agent result clears after insertion', "setLastGeneratedContent('')"],
])

checkFile('docs/v2.0/小说PRD.md', [
  ['PRD records P1 card wall completion', '/writing` 已从后台表格调整为作品卡片墙'],
  ['PRD records P1 workspace completion', '小说专用 100% 全屏三栏工作台'],
  ['PRD keeps P2 agent scope separate', '尚未完成 P2 的项目级上下文加载'],
])
const failed = checks.filter((item) => !item.ok)
for (const item of checks) {
  console.log(`${item.ok ? 'PASS' : 'FAIL'} ${item.label} (${item.path})`)
}
if (failed.length) {
  process.exitCode = 1
}

