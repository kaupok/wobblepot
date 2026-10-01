/**
 * Judging in Claude Code, the default for `--judge`.
 *
 * The judge is the one benchmark step that need not go through the API key:
 * it reads two answers and applies a rubric. So the benchmark exports every
 * judge prompt to `<stem>.judge-pairs.json`, a Claude Code session answers
 * them on the subscription (`/bench-judge`), and `--import-verdicts` folds
 * `<stem>.judge-verdicts.json` back into the report. `--judge-api` keeps the
 * API path (`runJudge`) for a pinned, reproducible judge model.
 *
 * **Blindness survives the split.** The pairs file holds only what
 * `buildJudgePrompt` would send: the case input and two answers labelled A
 * and B. Which role sat as A is the key, and the key stays in the run's
 * `.json` beside the report, which the judging session must not open. Both
 * orders of every pair are exported, so position bias cancels as under
 * `--judge-api`.
 */

import { z } from 'zod'
import type { BenchCase } from './case-schema'
import {
  buildJudgePrompt,
  combineVerdicts,
  other,
  pairsToJudge,
  toPick,
  JudgeVerdictSchema,
  type JudgeCall,
  type JudgedPair,
  type JudgedTask,
  type JudgeResult,
} from './judge'
import type { Role, RunResult } from './runner'

/** One prompt for the judging session. Nothing in it names a model or a role. */
export interface JudgeItem {
  /** `<caseId>#<run>#<a|b>`; the letter is the export order, not a role. */
  id: string
  task: JudgedTask
  system: string
  prompt: string
}

/** `<stem>.judge-pairs.json`: what the judging session reads. */
export interface JudgePairsFile {
  verdictsFile: string
  items: JudgeItem[]
}

export interface JudgeKeyPair {
  caseId: string
  task: JudgedTask
  run: number
  skipReason: string | null
  /** Baseline as A first, then candidate as A; empty when skipped. */
  items: { id: string; roleAsA: Role }[]
}

/** Written into the run's `.json`, never into the pairs file. */
export interface JudgeKey {
  pairsFile: string
  verdictsFile: string
  pairs: JudgeKeyPair[]
}

export const JudgeVerdictsFileSchema = z.object({
  /** Who judged, e.g. `claude-code/opus`. Shown in the report in place of a model ID. */
  judge: z.string().min(1),
  verdicts: z.array(JudgeVerdictSchema.extend({ id: z.string().min(1) })),
})
export type JudgeVerdictsFile = z.infer<typeof JudgeVerdictsFileSchema>

/**
 * The prompts for every pair, and the key to read the verdicts back. File
 * names are filled in by `writeReport`, which decides the stem.
 */
export function exportJudgePairs(
  result: RunResult,
  cases: BenchCase[],
): { items: JudgeItem[]; key: JudgeKey } {
  const items: JudgeItem[] = []
  const pairs: JudgeKeyPair[] = []

  pairsToJudge(result, cases).forEach(({ c, baseline, candidate, skipReason }, pairIndex) => {
    const base = { caseId: c.id, task: c.task, run: baseline.run }
    if (skipReason !== null) {
      pairs.push({ ...base, skipReason, items: [] })
      return
    }

    const output: Record<Role, unknown> = { baseline: baseline.output, candidate: candidate.output }
    // The letter alternates with the pair, so neither "a" nor "b" means a role.
    const letters = pairIndex % 2 === 0 ? ['a', 'b'] : ['b', 'a']
    const keyItems = (['baseline', 'candidate'] as const).map((roleAsA, i) => {
      const id = `${c.id}#${baseline.run}#${letters[i]}`
      const { system, prompt } = buildJudgePrompt(c, output[roleAsA], output[other(roleAsA)])
      items.push({ id, task: c.task, system, prompt })
      return { id, roleAsA }
    })
    pairs.push({ ...base, skipReason: null, items: keyItems })
  })

  return { items, key: { pairsFile: '', verdictsFile: '', pairs } }
}

/**
 * Verdicts back into a `JudgeResult`, through the same `toPick` and
 * `combineVerdicts` as the API judge. A pair with a verdict missing is a
 * judge error, as a failed API call would be; a verdict for an unknown id is
 * an error, since it means the file is for another run.
 */
export function importJudgeVerdicts(key: JudgeKey, file: JudgeVerdictsFile): JudgeResult {
  const known = new Set(key.pairs.flatMap((p) => p.items.map((i) => i.id)))
  const unknown = file.verdicts.filter((v) => !known.has(v.id)).map((v) => v.id)
  if (unknown.length > 0) {
    throw new Error(
      `Verdicts for ids this run never exported: ${unknown.join(', ')}. Is the file for another run?`,
    )
  }
  const byId = new Map(file.verdicts.map((v) => [v.id, v]))

  const pairs: JudgedPair[] = key.pairs.map((p) => {
    const base = { caseId: p.caseId, task: p.task, run: p.run }
    if (p.skipReason !== null) {
      return { ...base, outcome: 'skipped', skipReason: p.skipReason, calls: [] }
    }
    const calls: JudgeCall[] = p.items.map(({ id, roleAsA }) => {
      const v = byId.get(id)
      return {
        roleAsA,
        winner: v?.winner ?? null,
        pick: v ? toPick(v.winner, roleAsA) : null,
        reason: v?.reason ?? null,
        latencyMs: 0,
        usage: null,
        costUsd: 0,
        errorName: v ? null : 'MissingVerdict',
        errorMessage: v ? null : `No verdict for ${id} in ${key.verdictsFile}`,
      }
    })
    const [first, second] = calls as [JudgeCall, JudgeCall]
    return {
      ...base,
      outcome:
        first.pick === null || second.pick === null
          ? 'judge-error'
          : combineVerdicts(first.pick, second.pick),
      skipReason: null,
      calls,
    }
  })

  return { judge: file.judge, pairs, plannedPairs: key.pairs.length, spendUsd: 0, partial: false }
}
