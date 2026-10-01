/**
 * The committed golden baseline (HON-902).
 *
 * `--record` writes a passing `--check` run to `golden/<task>.json`, one file
 * per task so re-recording one task touches one file. `--baseline golden`
 * reads them back and replays their `CallRecord`s as the baseline side, so a
 * prompt change can be compared with the prompt that produced the golden, and
 * only the candidate is called.
 *
 * Each case carries the sha256 of the `promptText` it was recorded with. A
 * comparison counts the cases whose current prompt hashes differently: that is
 * how a prompt-change report shows which tasks the change reached.
 *
 * The files hold synthetic case inputs and model output only, and are meant to
 * be committed (`.prettierignore` keeps lint-staged from reformatting them).
 */

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import { TASKS, type BenchCase, type Task } from './case-schema'
import type { CallRecord, RunResult } from './runner'
import { prepareCase } from './tasks'

export const GOLDEN_DIR = join(dirname(fileURLToPath(import.meta.url)), 'golden')

/** The `--baseline` value that reads the golden instead of calling a model. */
export const GOLDEN = 'golden'

export function promptHash(promptText: string): string {
  return createHash('sha256').update(promptText).digest('hex')
}

const UsageSchema = z.object({
  model: z.string(),
  inputTokens: z.number(),
  cacheReadTokens: z.number(),
  cacheWriteTokens: z.number(),
  outputTokens: z.number(),
  usageMissing: z.boolean(),
  success: z.boolean().optional(),
})

const CallRecordSchema = z
  .object({
    caseId: z.string(),
    task: z.enum(TASKS),
    run: z.number().int().positive(),
    role: z.enum(['baseline', 'candidate']),
    model: z.string(),
    position: z.union([z.literal(1), z.literal(2)]),
    latencyMs: z.number(),
    attempts: z.number().int().optional(),
    finishReason: z.string().nullable(),
    usage: UsageSchema.nullable(),
    reasoningTokens: z.number().nullable(),
    costUsd: z.number(),
    errorName: z.string().nullable(),
    errorMessage: z.string().nullable(),
    output: z.unknown(),
    scores: z.record(z.string(), z.number().nullable()),
  })
  .transform((r) => r as CallRecord)

export const GoldenFileSchema = z.object({
  task: z.enum(TASKS),
  /** The model the task was recorded on. */
  model: z.string().min(1),
  /** Local `YYYY-MM-DD`, as the report dates its runs. */
  recordedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** Short `git rev-parse HEAD` the prompts were built from. */
  commit: z.string().min(1),
  runs: z.number().int().positive(),
  cases: z.record(
    z.string(),
    z.object({
      promptHash: z.string().regex(/^[0-9a-f]{64}$/),
      calls: z.array(CallRecordSchema),
    }),
  ),
})
export type GoldenFile = z.infer<typeof GoldenFileSchema>

/** What a golden comparison's report says about one task's golden. */
export const GoldenTaskInfoSchema = z.object({
  task: z.enum(TASKS),
  model: z.string(),
  recordedAt: z.string(),
  commit: z.string(),
  runs: z.number().int(),
  /** Cases in both the case set and the golden: the ones compared. */
  cases: z.number().int(),
  /** Of those, the cases whose prompt now hashes differently. */
  promptChanged: z.number().int(),
  /** Cases in the case set the golden has no record of. */
  notInGolden: z.array(z.string()),
})
export type GoldenTaskInfo = z.infer<typeof GoldenTaskInfoSchema>

export const goldenPath = (dir: string, task: Task) => join(dir, `${task}.json`)

/** One golden file per task the run covered, from a `--check` run's result. */
export function buildGoldenFiles(args: {
  result: RunResult
  cases: BenchCase[]
  tasks: readonly Task[]
  modelFor: (task: Task) => string
  runs: number
  recordedAt: string
  commit: string
}): GoldenFile[] {
  const { result, cases, modelFor, runs, recordedAt, commit } = args
  return TASKS.filter((t) => args.tasks.includes(t)).map((task) => ({
    task,
    model: modelFor(task),
    recordedAt,
    commit,
    runs,
    cases: Object.fromEntries(
      cases
        .filter((c) => c.task === task)
        .map((c) => [
          c.id,
          {
            promptHash: promptHash(prepareCase(c).promptText),
            calls: result.calls.filter((r) => r.caseId === c.id),
          },
        ]),
    ),
  }))
}

/** Writes `<dir>/<task>.json` for each file, replacing any earlier one. Returns the paths. */
export function writeGolden(dir: string, files: GoldenFile[]): string[] {
  mkdirSync(dir, { recursive: true })
  return files.map((file) => {
    const path = goldenPath(dir, file.task)
    writeFileSync(path, `${JSON.stringify(file, null, 2)}\n`)
    return path
  })
}

/** The task's golden, or `null` when none was recorded. Throws on a file that does not parse. */
export function readGolden(dir: string, task: Task): GoldenFile | null {
  const path = goldenPath(dir, task)
  if (!existsSync(path)) return null
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'))
  } catch (err) {
    throw new Error(`Golden ${path} is not valid JSON: ${(err as Error).message}`)
  }
  const parsed = GoldenFileSchema.safeParse(raw)
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ')
    throw new Error(`Invalid golden ${path}: ${issues}`)
  }
  if (parsed.data.task !== task) {
    throw new Error(`Golden ${path} is for task "${parsed.data.task}", not "${task}".`)
  }
  return parsed.data
}

/**
 * How the golden lines up with the current case set: which cases it covers,
 * how many of those have a changed prompt, and which current cases it lacks.
 * A golden case that no longer exists is ignored.
 */
export function compareGolden(golden: GoldenFile, cases: BenchCase[]): GoldenTaskInfo {
  const current = cases.filter((c) => c.task === golden.task)
  const covered = current.filter((c) => golden.cases[c.id])
  return {
    task: golden.task,
    model: golden.model,
    recordedAt: golden.recordedAt,
    commit: golden.commit,
    runs: golden.runs,
    cases: covered.length,
    promptChanged: covered.filter(
      (c) => golden.cases[c.id]!.promptHash !== promptHash(prepareCase(c).promptText),
    ).length,
    notInGolden: current.filter((c) => !golden.cases[c.id]).map((c) => c.id),
  }
}

/** The golden's records for the given cases, as the baseline side of a comparison. */
export function goldenBaselineCalls(goldens: GoldenFile[], cases: BenchCase[]): CallRecord[] {
  const byTask = new Map(goldens.map((g) => [g.task, g]))
  return cases
    .flatMap((c) => byTask.get(c.task)?.cases[c.id]?.calls ?? [])
    .map((r) => ({ ...r, role: 'baseline' as const }))
    .sort((a, b) => a.run - b.run)
}
