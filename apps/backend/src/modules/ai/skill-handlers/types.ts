import type { FastifyReply } from 'fastify'

import type { DatabaseService } from '../../../db/database.service'
import type { GridService } from '../../grid/grid.service'
import type { AiRuntimeActionItem, AiRuntimeReferenceItem } from '@xiaochuang/contracts'

// Services bundle that AiService passes to each handler. Add to this interface
// when a new handler needs a backend service that isn't already on
// SkillHandlerContext directly. Avoid plumbing service singletons through
// payload — that hides the dependency and breaks DI testing.
export interface SkillHandlerServices {
  gridService: GridService
}

// ──────────────────────────────────────────────────────────────────────────
// SkillHandler contract
//
// Every entry in `apps/backend/src/modules/ai/skill-handlers/` exports a
// SkillHandler. AiService registers them by skill_id; unmatched skill_ids
// fall through to the default writing-domain implementation in
// AiService.run(). Handlers own everything skill-specific:
//
//   1. payload validation (target shape, required ids, allowed mode/scene)
//   2. context loading (read DB, build user-facing message)
//   3. LLM call (or no LLM at all — grid_prompt handler does pure backend work)
//   4. side effects on success (writing back to DB tables)
//   5. ai_runs ledger entry (or explicitly null for non-creative calls)
//
// AiService never reaches into a handler's internals; it only:
//   - loads the SKILL.md and hands it to handler.ctx.skillPrompt
//   - resolves stream vs non-stream and passes reply
//   - awaits the returned response
//
// The frontend SSE contract is `{ type: 'status' | 'delta' | 'done' | 'error' }`
// (see apps/web/src/hooks/use-workbench.ts:246-264). Handlers must emit
// events shaped like that to keep the workbench unchanged through migration.
// ──────────────────────────────────────────────────────────────────────────

export interface SkillHandlerContext {
  /** Full SKILL.md text, ready to drop into the system prompt slot. */
  skillPrompt: string
  /** The validated /ai/runs request body, exactly as parsed by ai.controller.ts. */
  payload: any
  /** Authenticated session user (already verified by SessionAuthGuard). */
  currentUser: { id: number }
  databaseService: DatabaseService
  /** Backend services injected by AiService via Nest DI. */
  services: SkillHandlerServices
  /** Fastify reply, only meaningful for streaming handlers that set SSE headers. */
  reply: FastifyReply
  /** True when the caller wants Server-Sent Events; false when they want a JSON snapshot. */
  stream: boolean
}

export interface SkillHandlerResult {
  /**
   * - `FastifyReply` when handler runs in streaming mode and attaches the SSE
   *   stream to the current reply.
   * - `{ type:'done', text, references, actions }` for non-stream callers,
   *   shaped to match AiService.nonStreamChat's return contract so callers
   *   don't need to branch on skill type.
   */
  response: FastifyReply | {
    type: 'done'
    text: string
    references: AiRuntimeReferenceItem[]
    actions: AiRuntimeActionItem[]
  }
}

export type SkillHandler = (ctx: SkillHandlerContext) => Promise<SkillHandlerResult>
