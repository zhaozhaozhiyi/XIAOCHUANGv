#!/usr/bin/env node
/**
 * verify:skill-driven — static gate for the unified AI skill runtime.
 *
 * After T1-T9 of .claude/plans/skill-driven-ai-runtime.md, interactive AI
 * calls in the platform should flow through:
 *
 *     POST /api/v1/ai/runs
 *       → AiService.run()
 *       → SKILL.md loaded from skills/<skill_id>/SKILL.md
 *       → registered SkillHandler under apps/backend/src/modules/ai/skill-handlers/
 *
 * Long-running drama production uses a second, equally constrained path:
 *
 *     task handler → AgentRuntimeService → Hermes
 *       → release-pinned SKILL.md bundle + xiaochuang-drama MCP
 *       → ModelGatewayService → Provider
 *
 * This script enforces those boundaries at commit time. It does four grouped
 * checks:
 *
 *   1. Backend chat/completions calls — only established AI-runtime
 *      boundaries may talk to a Provider directly. Anything else (e.g. a
 *      business module growing its own ad-hoc fetch) is rejected.
 *   2. Frontend agent path — /api/v1/agent/ is gone (T5 deleted the controller).
 *      Any frontend reference would 404 at runtime, so we fail at lint time.
 *   3. Skill ↔ SKILL.md double-pointer — every interactive skill_id literal
 *      and every versioned Agent Runtime Skill reference must have a matching
 *      SKILL.md. Every SKILL.md must have at least one real consumer.
 *      apps/web/src/**.{ts,tsx} must have a matching skills/<id>/SKILL.md, and
 *      every SKILL.md must have at least one consumer (frontend literal or
 *      backend handler registration). Catches both orphan SKILL.md (like the
 *      writing-ai/writing_assistant pre-cleanup state) and dangling skill_id
 *      that would 500 at /api/v1/ai/runs.
 *   4. Handler ↔ SKILL.md correspondence — every entry in AiService's
 *      SKILL_HANDLERS map must have a matching skill-handlers/<id>.handler.ts
 *      file AND a matching SKILL.md.
 *
 * The script does NOT check writing_copilot's behavior (that's verified by
 * verify:ai-runtime, which exercises the writing-domain default path).
 *
 * Exit code: 0 if all checks pass, 1 otherwise.
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// ──────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────

const issues = []
const passes = []

function record(ok, label, detail = '') {
  if (ok) passes.push({ label, detail })
  else issues.push({ label, detail })
}

function* walk(dir, extensions) {
  if (!fs.existsSync(dir)) return
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      // Skip build/cache folders
      if (entry.name === 'node_modules' || entry.name === 'dist'
        || entry.name === '.next' || entry.name === '.next-prod') continue
      yield* walk(full, extensions)
    } else if (extensions.some((ext) => entry.name.endsWith(ext))) {
      yield full
    }
  }
}

function readFile(file) {
  return fs.readFileSync(file, 'utf8')
}

function relativeToRepo(file) {
  return path.relative(repoRoot, file).replaceAll('\\', '/')
}

// ──────────────────────────────────────────────────────────────────────────
// Check 1: Backend chat/completions allowlist
// ──────────────────────────────────────────────────────────────────────────

const CHAT_COMPLETIONS_WHITELIST = new Set([
  // The default writing-domain path (used by writing_copilot).
  'apps/backend/src/modules/ai/ai.service.ts',
  // Builds a connectivity-test endpoint URL string for the admin
  // 'test config' button. Doesn't call the LLM — assembles a URL that the
  // admin then POSTs to. The string '/chat/completions' appears as a literal
  // segment of the URL builder, not as a fetch site.
  'apps/backend/src/modules/ai-configs/ai-configs.utils.ts',
  // ──────────────────────────────────────────────────────────────────────
  // Writing-domain auxiliary AI calls. These predate the skill-driven
  // closeup and are NOT yet migrated. They issue their own chat/completions
  // requests for action-style helpers (summarize / extract_outline) and the
  // standalone writing-agent SSE chat. Migrating them is tracked as a
  // follow-up — they'd become two new skill_ids:
  //   - writing_action  (skills/writing-action/SKILL.md, handler with mode-specific prompts)
  //   - writing_agent   (skills/writing-agent/SKILL.md, replaces /writing-agent/chat)
  // Until then they ride this whitelist with an explicit comment so any new
  // file added here has to either (a) be one of these two known cases or
  // (b) get flagged in code review.
  'apps/backend/src/modules/writings/writings.service.ts',
  'apps/backend/src/modules/writings/writing-agent.controller.ts',
  // The compatibility path used only while AGENT_RUNTIME_PROVIDER is
  // disabled. Its system instructions are still loaded from
  // drama_adaptation_copilot/SKILL.md; the production Agent path goes through
  // Hermes and ModelGatewayService below.
  'apps/backend/src/modules/dramas/drama-agent.service.ts',
  // The only process allowed to forward a managed Hermes model request to a
  // user-scoped Provider. The controller/types contain the protocol path, and
  // the service owns the authenticated fetch.
  'apps/backend/src/modules/agent-runtime/model-gateway.controller.ts',
  'apps/backend/src/modules/agent-runtime/model-gateway.service.ts',
  'apps/backend/src/modules/agent-runtime/model-gateway.types.ts',
])
const CHAT_COMPLETIONS_WHITELIST_PREFIXES = [
  'apps/backend/src/modules/ai/skill-handlers/',
  // Mock AI server lives in apps/backend too but it's an LLM *server*,
  // not a client; it's exempt from the rule.
  'apps/backend/src/mock-ai',
]

function isChatCompletionsAllowed(file) {
  const rel = relativeToRepo(file)
  // Tests may describe protocol URLs or mock Provider responses. They are not
  // runtime LLM call sites and should not weaken the production boundary.
  if (rel.endsWith('.test.ts')) return true
  if (CHAT_COMPLETIONS_WHITELIST.has(rel)) return true
  return CHAT_COMPLETIONS_WHITELIST_PREFIXES.some((prefix) => rel.startsWith(prefix))
}

const backendDir = path.join(repoRoot, 'apps/backend/src')
const offenders = []
for (const file of walk(backendDir, ['.ts'])) {
  const content = readFile(file)
  if (!/chat\/completions/.test(content)) continue
  if (isChatCompletionsAllowed(file)) continue
  offenders.push(relativeToRepo(file))
}
record(
  offenders.length === 0,
  'backend chat/completions limited to AI runtime',
  offenders.length ? `offenders: ${offenders.join(', ')}` : '',
)

// ──────────────────────────────────────────────────────────────────────────
// Check 2: Frontend has no /api/v1/agent/ references
// ──────────────────────────────────────────────────────────────────────────

const webDir = path.join(repoRoot, 'apps/web/src')
const agentRefs = []
// Only flag references inside string literals (URLs the code actually fetches).
// The path is mentioned in some comments documenting the migration; those are
// fine and shouldn't fail the gate.
// Exclude newlines from the negated class so the match cannot span across
// lines and accidentally pick up a doc comment that sits between two
// unrelated string literals on different lines.
const AGENT_URL_RE = /['"`][^'"`\n]*\/api\/v1\/agent\/[^'"`\n]*['"`]/
for (const file of walk(webDir, ['.ts', '.tsx'])) {
  const content = readFile(file)
  if (AGENT_URL_RE.test(content)) {
    agentRefs.push(relativeToRepo(file))
  }
}
record(
  agentRefs.length === 0,
  'frontend /api/v1/agent/ path is dead',
  agentRefs.length ? `references: ${agentRefs.join(', ')}` : '',
)

// ──────────────────────────────────────────────────────────────────────────
// Check 3: Skill ↔ SKILL.md double-pointer
// ──────────────────────────────────────────────────────────────────────────

// Collect skill_id literals from frontend.
const frontendSkillIds = new Map() // skill_id -> [files]
const SKILL_ID_RE = /skill_id:\s*['"]([\w-]+)['"]/g
for (const file of walk(webDir, ['.ts', '.tsx'])) {
  const content = readFile(file)
  for (const match of content.matchAll(SKILL_ID_RE)) {
    const id = match[1]
    if (!frontendSkillIds.has(id)) frontendSkillIds.set(id, [])
    frontendSkillIds.get(id).push(relativeToRepo(file))
  }
}

// Collect skill_id from backend handler registry.
const aiServiceSrc = readFile(path.join(repoRoot, 'apps/backend/src/modules/ai/ai.service.ts'))
const HANDLER_REGISTER_RE = /\[\s*['"]([\w-]+)['"],\s*\w+Handler\s*\]/g
const registeredSkillIds = new Set()
for (const match of aiServiceSrc.matchAll(HANDLER_REGISTER_RE)) {
  registeredSkillIds.add(match[1])
}

// Agent Runtime Skills are intentionally not registered in AiService: they
// are pinned to a Hermes execution profile as `skill_id@version`. Scan the
// production runtime and drama task-handler sources so those Skills remain
// subject to the same consumer and dangling-reference checks.
const runtimeSkillRefs = new Map() // ref -> [files]
const RUNTIME_SKILL_REF_RE =
  /['"](([A-Za-z0-9_/-]+)@[A-Za-z0-9._-]+)['"]/g
const runtimeConsumerDirs = [
  path.join(repoRoot, 'apps/backend/src/modules/agent-runtime'),
  path.join(repoRoot, 'apps/backend/src/modules/tasks/domain-handlers'),
]
for (const dir of runtimeConsumerDirs) {
  for (const file of walk(dir, ['.ts'])) {
    if (file.endsWith('.test.ts')) continue
    const content = readFile(file)
    for (const match of content.matchAll(RUNTIME_SKILL_REF_RE)) {
      const ref = match[1]
      if (!runtimeSkillRefs.has(ref)) runtimeSkillRefs.set(ref, [])
      runtimeSkillRefs.get(ref).push(relativeToRepo(file))
    }
  }
}

// Some compatibility code consumes a Skill directly from SkillsService rather
// than through the interactive registry or Hermes. Keep that use explicit so
// it cannot silently turn into a hard-coded prompt.
const directBackendSkillConsumers = new Map() // folder -> [files]
const DIRECT_SKILL_CONTENT_RE =
  /getSkillContent\(\s*\[\s*['"]([A-Za-z0-9_-]+)['"]\s*\]\s*\)/g
for (const file of walk(backendDir, ['.ts'])) {
  if (file.endsWith('.test.ts')) continue
  const content = readFile(file)
  for (const match of content.matchAll(DIRECT_SKILL_CONTENT_RE)) {
    const folder = match[1]
    if (!directBackendSkillConsumers.has(folder)) {
      directBackendSkillConsumers.set(folder, [])
    }
    directBackendSkillConsumers.get(folder).push(relativeToRepo(file))
  }
}

// Collect SKILL.md folders. The loader at ai.service.ts:loadSkillPrompt
// accepts both <id>/SKILL.md and <id-with-_-replaced-by->/SKILL.md, so when
// a skill_id has underscores we also accept the dashed variant.
const skillsDir = path.join(repoRoot, 'skills')
const skillFolders = new Set()
if (fs.existsSync(skillsDir)) {
  for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true })) {
    if (entry.isDirectory() && fs.existsSync(path.join(skillsDir, entry.name, 'SKILL.md'))) {
      skillFolders.add(entry.name)
    }
  }
}

function skillFolderForId(skillId) {
  if (skillFolders.has(skillId)) return skillId
  const dashed = skillId.replace(/_/g, '-')
  if (skillFolders.has(dashed)) return dashed
  return null
}

// 3a: every frontend skill_id has a SKILL.md.
const danglingFrontend = []
for (const [id, files] of frontendSkillIds) {
  if (!skillFolderForId(id)) {
    danglingFrontend.push(`${id} (used in ${files.join(', ')})`)
  }
}
record(
  danglingFrontend.length === 0,
  'every frontend skill_id has a matching SKILL.md',
  danglingFrontend.length ? danglingFrontend.join(' | ') : '',
)

// 3b: every backend-registered skill_id has a SKILL.md.
const danglingBackend = []
for (const id of registeredSkillIds) {
  if (!skillFolderForId(id)) {
    danglingBackend.push(id)
  }
}
record(
  danglingBackend.length === 0,
  'every registered handler has a matching SKILL.md',
  danglingBackend.length ? danglingBackend.join(', ') : '',
)

// 3c: every release-pinned Runtime Skill reference has a SKILL.md.
const danglingRuntimeSkills = []
for (const [ref, files] of runtimeSkillRefs) {
  const skillId = ref.slice(0, ref.lastIndexOf('@'))
  if (!skillFolderForId(skillId)) {
    danglingRuntimeSkills.push(`${ref} (used in ${files.join(', ')})`)
  }
}
record(
  danglingRuntimeSkills.length === 0,
  'every runtime Skill binding has a matching SKILL.md',
  danglingRuntimeSkills.length ? danglingRuntimeSkills.join(' | ') : '',
)

// 3d: every SKILL.md has at least one consumer (frontend literal, interactive
// backend handler, versioned Runtime binding, or an explicit compatibility
// loader).
// writing_copilot is consumed by writing-chat-panel.tsx (frontend literal).
// quick-video-session-title is consumed only via AiService.run() inside the
// quick-video-sessions controller (backend), not via a literal.
const orphanSkills = []
for (const folder of skillFolders) {
  const usedByFrontend = [...frontendSkillIds.keys()].some((id) => skillFolderForId(id) === folder)
  const usedByBackend = [...registeredSkillIds].some((id) => skillFolderForId(id) === folder)
    || aiServiceSrc.includes(`'${folder}'`) || aiServiceSrc.includes(`"${folder}"`)
  const usedByRuntime = [...runtimeSkillRefs.keys()].some((ref) => {
    const skillId = ref.slice(0, ref.lastIndexOf('@'))
    return skillFolderForId(skillId) === folder
  })
  const usedByCompatibilityLoader = directBackendSkillConsumers.has(folder)
  // Also accept: the controller imports a buildSessionTitleHistoryText
  // helper from a handler whose skill_id matches the folder name. This
  // covers the quick-video-session-title path.
  if (
    !usedByFrontend &&
    !usedByBackend &&
    !usedByRuntime &&
    !usedByCompatibilityLoader
  ) {
    orphanSkills.push(folder)
  }
}
record(
  orphanSkills.length === 0,
  'no orphan SKILL.md folders',
  orphanSkills.length ? orphanSkills.join(', ') : '',
)

// ──────────────────────────────────────────────────────────────────────────
// Check 4: Handler ↔ SKILL.md correspondence in skill-handlers folder
// ──────────────────────────────────────────────────────────────────────────

const handlersDir = path.join(repoRoot, 'apps/backend/src/modules/ai/skill-handlers')
const handlerFiles = fs.existsSync(handlersDir)
  ? fs.readdirSync(handlersDir).filter((f) => f.endsWith('.handler.ts'))
  : []

// Each handler file should map to a registered skill_id (we don't enforce a
// strict filename → skill_id rule because some handlers cover an id with
// underscores like 'voice_assigner' but the file is dashed
// 'voice-assigner.handler.ts'). Instead we check: every handler file's
// exported function appears in the AiService registry.
const orphanHandlerFiles = []
for (const file of handlerFiles) {
  const content = readFile(path.join(handlersDir, file))
  const exportMatch = /export\s+const\s+(\w+Handler)\s*:/.exec(content)
  if (!exportMatch) continue // _shared.ts and types.ts are filtered out by .handler.ts suffix
  const exportName = exportMatch[1]
  if (!aiServiceSrc.includes(exportName)) {
    orphanHandlerFiles.push(`${file} exports ${exportName} but AiService never imports it`)
  }
}
record(
  orphanHandlerFiles.length === 0,
  'every skill-handler file is registered in AiService',
  orphanHandlerFiles.length ? orphanHandlerFiles.join(' | ') : '',
)

// ──────────────────────────────────────────────────────────────────────────
// Output
// ──────────────────────────────────────────────────────────────────────────

for (const item of passes) {
  console.log(`PASS ${item.label}${item.detail ? ` — ${item.detail}` : ''}`)
}
for (const item of issues) {
  console.log(`FAIL ${item.label}${item.detail ? ` — ${item.detail}` : ''}`)
}
console.log(`\n${passes.length} passed, ${issues.length} failed`)

if (issues.length) {
  process.exitCode = 1
}
