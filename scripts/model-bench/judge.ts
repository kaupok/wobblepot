/**
 * Blind pairwise judge for the model benchmark (HON-798).
 *
 * The deterministic scorers cannot see whether an imagined meal sounds good or
 * whether a tip is useful, so for imagine and tips a stronger model compares
 * the baseline's and the candidate's output for the same case and run.
 *
 * **Blind:** the judge sees the case input and two answers labelled A and B.
 * No model ID, and neither the word "baseline" nor "candidate", reaches it.
 *
 * **Both orders:** each pair is judged twice, once with the baseline as A and
 * once with the candidate as A, which cancels position bias. The candidate
 * wins the pair only when both orders pick it, loses only when both pick the
 * baseline, and anything else is a tie.
 *
 * **Two judges.** `--judge` (the default) exports the prompts for a Claude
 * Code session to answer on the subscription, and `--import-verdicts` folds
 * the answers back in; see `judge-files.ts`. `--judge-api` has `JUDGE_MODEL`
 * answer them here through the API key (`runJudge`). The prompts, the verdict
 * rules and the summary are the same either way.
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { generateObject, NoObjectGeneratedError, type LanguageModelUsage } from 'ai'
import { z } from 'zod'
import { imaginedIngredientText, type ImaginedIngredient } from '../../src/lib/ai/imagine-request'
import { estimateCostUsd } from '../../src/lib/ai/pricing'
import { toAiUsageStats, type AiUsageStats } from '../../src/lib/ai/usage-mapping'
import type { BenchCase, CaseOf, Task } from './case-schema'
import type { CallRecord, ModelFactory, Role, RunResult } from './runner'

/** Not an app model, so it lives here rather than in `src/lib/ai/models.ts`. */
export const JUDGE_MODEL = 'claude-opus-5-5'

/** Recipe, plan and review are left to their deterministic scores. */
export const JUDGED_TASKS = ['imagine', 'tips'] as const satisfies readonly Task[]
export type JudgedTask = (typeof JUDGED_TASKS)[number]

/** A candidate win rate under this is a regression… */
export const JUDGE_MIN_WIN_RATE = 0.4
/** …once at least this many pairs were decided (won or lost, not tied). */
export const JUDGE_MIN_DECIDED = 5

/**
 * Headroom for Opus 5.5's thinking, which cannot be turned off, plus a
 * one-sentence verdict. A truncated verdict is a judge error, not a tie.
 */
const JUDGE_MAX_OUTPUT_TOKENS = 8_000

/** Marks the judge's system prompt for Anthropic's prompt cache. */
export const JUDGE_SYSTEM_CACHE = { anthropic: { cacheControl: { type: 'ephemeral' } } } as const

/** Output tokens per judge call, reasoning included, for the dry-run estimate only. */
export const JUDGE_DRY_RUN_OUTPUT_TOKENS = 1_500

const HERE = dirname(fileURLToPath(import.meta.url))
const RUBRIC_PATH = join(HERE, 'judge-prompt.md')
const VOICE_ET_PATH = join(HERE, '..', '..', 'docs', 'AI_VOICE_ET.md')

export const JudgeVerdictSchema = z.object({
  winner: z
    .enum(['A', 'B', 'tie'])
    .describe(
      'The better answer, or "tie" when neither is better in a way the household would notice',
    ),
  reason: z.string().describe('One sentence naming the deciding difference'),
})

export type Winner = z.infer<typeof JudgeVerdictSchema>['winner']
/** A verdict mapped back from its label to the role that wrote the answer. */
export type Pick = Role | 'tie'
/** The pair's result for the candidate. */
export type Outcome = 'win' | 'loss' | 'tie'

export interface JudgeCall {
  /** Which role's answer was shown as A in this call. */
  roleAsA: Role
  /** `null` when the call failed. */
  winner: Winner | null
  pick: Pick | null
  reason: string | null
  latencyMs: number
  usage: AiUsageStats | null
  costUsd: number
  errorName: string | null
  errorMessage: string | null
}

export interface JudgedPair {
  caseId: string
  task: JudgedTask
  run: number
  /**
   * `skipped` when either side's benchmark call errored: there is nothing to
   * compare. `judge-error` when a judge call failed, which is evidence about
   * the judge, not about either model.
   */
  outcome: Outcome | 'skipped' | 'judge-error'
  skipReason: string | null
  /** Baseline as A first, then candidate as A. Empty when skipped. */
  calls: JudgeCall[]
}

export interface JudgeResult {
  /** Who judged: `JUDGE_MODEL` under `--judge-api`, else the label the verdicts file gave. */
  judge: string
  pairs: JudgedPair[]
  /** Pairs the benchmark produced for judged tasks, skipped ones included. */
  plannedPairs: number
  /** Judge calls only. */
  spendUsd: number
  /** `true` when `--max-usd` stopped the judge before every pair was judged. */
  partial: boolean
}

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

let rubric: string | undefined
let voiceEt: string | undefined

function readRubric(): string {
  return (rubric ??= readFileSync(RUBRIC_PATH, 'utf8').trim())
}

function readVoiceEt(): string {
  return (voiceEt ??= readFileSync(VOICE_ET_PATH, 'utf8').trim())
}

export function isJudgedTask(task: Task): task is JudgedTask {
  return (JUDGED_TASKS as readonly Task[]).includes(task)
}

function taskLabel(c: CaseOf<JudgedTask>): string {
  return c.task === 'tips' ? `tips (${c.input.kind})` : c.task
}

/** What the app sent. `forbiddenKeywords` and `allowedQualifiers` are the scorer's, not the app's. */
function judgeInput(c: CaseOf<JudgedTask>): unknown {
  if (c.task === 'imagine') {
    const { forbiddenKeywords: _scorerOnly, allowedQualifiers: _alsoScorerOnly, ...input } = c.input
    return input
  }
  return c.input
}

interface ImagineOutput {
  meals?: {
    name?: string
    description?: string | null
    timeMinutes?: number | null
    servings?: number
    ingredients?: ImaginedIngredient[]
  }[]
}

/**
 * Imagine is judged on what the user reads: names, descriptions, ingredient
 * lists, and the time and servings the rubric's accuracy point checks. The
 * flags the app acts on (`mealTypes`, `kidFriendly`, the parsed quantity
 * fields) are left out.
 */
function judgeOutput(c: CaseOf<JudgedTask>, output: unknown): unknown {
  if (c.task !== 'imagine') return output
  const { locale } = c.input
  const meals = (output as ImagineOutput | null)?.meals ?? []
  return {
    meals: meals.map((m) => ({
      name: m.name,
      description: m.description,
      timeMinutes: m.timeMinutes,
      servings: m.servings,
      // The line the review dialog shows; the model no longer writes it (HON-897).
      ingredients: (m.ingredients ?? []).map((i) => imaginedIngredientText(i, locale)),
    })),
  }
}

const json = (value: unknown) => JSON.stringify(value, null, 2)

/**
 * The judge's request for one ordering of a pair. Takes the two answers
 * already placed as A and B, so nothing about which model wrote which can
 * reach it.
 */
export function buildJudgePrompt(
  c: CaseOf<JudgedTask>,
  answerA: unknown,
  answerB: unknown,
): { system: string; prompt: string } {
  let system = readRubric()
  if (c.input.locale === 'et') {
    system += `

## Estonian voice

The input locale is \`et\`, so the answers should be in Estonian. Under point 4, hold every Estonian string to the voice reference below: an answer that reads as translated from English, or breaks its register, naming or description rules, is written worse than one that does not. Voice never outweighs points 1 to 3.

<voice_reference>
${readVoiceEt()}
</voice_reference>`
  }

  const prompt = `Task: ${taskLabel(c)}

<input>
${json(judgeInput(c))}
</input>

<answer_a>
${json(judgeOutput(c, answerA))}
</answer_a>

<answer_b>
${json(judgeOutput(c, answerB))}
</answer_b>`

  return { system, prompt }
}

// ---------------------------------------------------------------------------
// Verdicts
// ---------------------------------------------------------------------------

export const other = (role: Role): Role => (role === 'baseline' ? 'candidate' : 'baseline')

export function toPick(winner: Winner, roleAsA: Role): Pick {
  if (winner === 'tie') return 'tie'
  return winner === 'A' ? roleAsA : other(roleAsA)
}

/** Win or loss only when both orders agree; a disagreement or a `tie` is a tie. */
export function combineVerdicts(first: Pick, second: Pick): Outcome {
  if (first === 'candidate' && second === 'candidate') return 'win'
  if (first === 'baseline' && second === 'baseline') return 'loss'
  return 'tie'
}

// ---------------------------------------------------------------------------
// Running
// ---------------------------------------------------------------------------

export interface JudgeOptions {
  result: RunResult
  cases: BenchCase[]
  maxUsd: number
  modelFactory: ModelFactory
  /** Milliseconds; defaults to `performance.now`. */
  now?: () => number
  onPair?: (pair: JudgedPair, progress: { done: number; planned: number; spendUsd: number }) => void
}

/** One judged case and run with both sides' records. */
export interface JudgePair {
  c: CaseOf<JudgedTask>
  baseline: CallRecord
  candidate: CallRecord
  /** Set when either side errored: there is nothing to compare. */
  skipReason: string | null
}

/**
 * Every imagine and tips pair the benchmark produced, in the order it ran
 * them. A side missing from a `--max-usd` stop leaves no pair at all.
 */
export function pairsToJudge(result: RunResult, cases: BenchCase[]): JudgePair[] {
  const caseById = new Map(cases.map((c) => [c.id, c]))

  const sides = new Map<string, Partial<Record<Role, CallRecord>>>()
  for (const call of result.calls) {
    if (!isJudgedTask(call.task)) continue
    const key = `${call.caseId}\u0000${call.run}`
    sides.set(key, { ...sides.get(key), [call.role]: call })
  }

  return [...sides.values()]
    .filter((s): s is Record<Role, CallRecord> => Boolean(s.baseline && s.candidate))
    .map(({ baseline, candidate }) => {
      const c = caseById.get(baseline.caseId)
      if (!c || !isJudgedTask(c.task)) {
        throw new Error(`No judged case "${baseline.caseId}" for a judged call record.`)
      }
      const errored = [baseline, candidate].filter((r) => r.errorName !== null).map((r) => r.role)
      return {
        c: c as CaseOf<JudgedTask>,
        baseline,
        candidate,
        skipReason: errored.length > 0 ? `${errored.join(' and ')} errored` : null,
      }
    })
}

/**
 * Judge every pair through the API, in the order the benchmark ran them.
 * Spend continues from the benchmark's: judge calls count toward the same
 * `--max-usd`. The limit is checked before each pair, not each call, so a
 * pair is always judged in both orders; the overshoot is at most one pair,
 * two judge calls.
 */
export async function runJudge(options: JudgeOptions): Promise<JudgeResult> {
  const { result, cases, maxUsd, modelFactory, onPair } = options
  const now = options.now ?? (() => performance.now())
  const pending = pairsToJudge(result, cases)

  const pairs: JudgedPair[] = []
  let spendUsd = 0
  const totalSpend = () => result.spendUsd + spendUsd
  const model = modelFactory(JUDGE_MODEL)

  for (const { c, baseline, candidate, skipReason } of pending) {
    if (totalSpend() > maxUsd) {
      return { judge: JUDGE_MODEL, pairs, plannedPairs: pending.length, spendUsd, partial: true }
    }

    const base = { caseId: baseline.caseId, task: c.task, run: baseline.run }

    let pair: JudgedPair
    if (skipReason !== null) {
      pair = { ...base, outcome: 'skipped', skipReason, calls: [] }
    } else {
      const output: Record<Role, unknown> = {
        baseline: baseline.output,
        candidate: candidate.output,
      }
      const calls: JudgeCall[] = []
      for (const roleAsA of ['baseline', 'candidate'] as const) {
        const { system, prompt } = buildJudgePrompt(c, output[roleAsA], output[other(roleAsA)])
        const call = await judgeOnce({ model, system, prompt, roleAsA, now })
        calls.push(call)
        spendUsd += call.costUsd
      }
      const [first, second] = calls as [JudgeCall, JudgeCall]
      pair = {
        ...base,
        outcome:
          first.pick === null || second.pick === null
            ? 'judge-error'
            : combineVerdicts(first.pick, second.pick),
        skipReason: null,
        calls,
      }
    }

    pairs.push(pair)
    onPair?.(pair, { done: pairs.length, planned: pending.length, spendUsd: totalSpend() })
  }

  return { judge: JUDGE_MODEL, pairs, plannedPairs: pending.length, spendUsd, partial: false }
}

async function judgeOnce(args: {
  model: ReturnType<ModelFactory>
  system: string
  prompt: string
  roleAsA: Role
  now: () => number
}): Promise<JudgeCall> {
  const { model, system, prompt, roleAsA, now } = args
  let usage: LanguageModelUsage | undefined
  let winner: Winner | null = null
  let reason: string | null = null
  let errorName: string | null = null
  let errorMessage: string | null = null
  let latencyMs: number

  const start = now()
  try {
    const result = await generateObject({
      model,
      schema: JudgeVerdictSchema,
      // The rubric is the same for every pair and order of a locale, ~600
      // tokens in English and ~5,400 with the Estonian voice reference, so
      // cache it (HON-899). Opus 5.5 caches a prefix from 512 tokens.
      system: { role: 'system', content: system, providerOptions: JUDGE_SYSTEM_CACHE },
      prompt,
      maxOutputTokens: JUDGE_MAX_OUTPUT_TOKENS,
    })
    latencyMs = now() - start
    usage = result.usage
    winner = result.object.winner
    reason = result.object.reason
  } catch (err) {
    latencyMs = now() - start
    errorName = err instanceof Error ? err.name : 'UnknownError'
    errorMessage = err instanceof Error ? err.message : String(err)
    // Billed even though the verdict was unusable.
    if (NoObjectGeneratedError.isInstance(err)) usage = err.usage
  }

  const stats = usage ? toAiUsageStats(JUDGE_MODEL, usage) : null
  return {
    roleAsA,
    winner,
    pick: winner === null ? null : toPick(winner, roleAsA),
    reason,
    latencyMs,
    usage: stats,
    costUsd: stats ? estimateCostUsd(stats) : 0,
    errorName,
    errorMessage,
  }
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

export interface JudgeTaskSummary {
  task: JudgedTask
  wins: number
  ties: number
  losses: number
  skipped: number
  judgeErrors: number
  /** Wins plus losses. */
  decided: number
  /** Wins ÷ decided; `null` with nothing decided. Ties are left out. */
  winRate: number | null
  /**
   * `regression` when the win rate is under 40% over at least 5 decided
   * pairs; `too-few` below 5 decided pairs, where nothing is flagged.
   */
  status: 'ok' | 'regression' | 'too-few'
}

export function summarizeJudge(
  pairs: JudgedPair[],
  tasks: readonly JudgedTask[],
): JudgeTaskSummary[] {
  return tasks.map((task) => {
    const mine = pairs.filter((p) => p.task === task)
    const count = (outcome: JudgedPair['outcome']) =>
      mine.filter((p) => p.outcome === outcome).length
    const wins = count('win')
    const losses = count('loss')
    const decided = wins + losses
    const winRate = decided === 0 ? null : wins / decided
    return {
      task,
      wins,
      ties: count('tie'),
      losses,
      skipped: count('skipped'),
      judgeErrors: count('judge-error'),
      decided,
      winRate,
      status:
        decided < JUDGE_MIN_DECIDED
          ? 'too-few'
          : winRate! < JUDGE_MIN_WIN_RATE
            ? 'regression'
            : 'ok',
    }
  })
}
