/**
 * Lightweight AI output sampling for ongoing voice review (HON-504) and for
 * growing the model benchmark's case set from real inputs (HON-903).
 *
 * `logAiSample` is the single entry point. Call it after every successful
 * `generateObject` invocation. Behaviour:
 *
 *   - Non-default locale calls are always logged: Estonian output is what the
 *     voice review reads.
 *   - Default locale (English) calls are logged at `DEFAULT_LOCALE_SAMPLE_RATE`,
 *     5%, so production inputs in English can become benchmark cases
 *     (`pnpm ai-eval --import-sample`) without logging every call. Each
 *     line carries its `sampleRate`, so a count can be weighted back up.
 *   - A logged call emits a single structured JSON line to stdout prefixed
 *     with `[ai-sample]`. Vercel captures stdout to log streams, so this is
 *     queryable in staging/prod without any new infrastructure.
 *   - In `NODE_ENV !== 'production'`, also append the same JSON line to
 *     `.ai-samples/<YYYY-MM-DD>.jsonl` so dev review can `tail -f`. The
 *     directory is gitignored.
 *
 * Privacy contract:
 *   - Caller is responsible for stripping user/household identifiers from
 *     `input` and `output`. The helper trusts what it receives. Pass only the
 *     AI-visible input and the AI output — never user IDs, household IDs, or
 *     session tokens. Mirrors HON-504's "AI-visible input + AI output only;
 *     never user identifiers" rule.
 *
 * Resilience:
 *   - Never throws. AI features must not break because logging failed —
 *     mirrors `recordAiUsage`'s contract. Internal errors are surfaced via
 *     `console.error` only.
 */

import { mkdir, appendFile } from 'node:fs/promises'
import path from 'node:path'
import { isDefaultLocale } from '@/lib/i18n/locales'

export type AiSampleCallSite =
  | 'generate-plan'
  | 'fill-empty-slots'
  | 'imagine-meal'
  | 'parse-recipe'
  | 'review-quantities'
  | 'preparation-tips-full'
  | 'preparation-tips-supplementary'

export interface AiSampleInput {
  callSite: AiSampleCallSite
  locale: string | null | undefined
  input: unknown
  output: unknown
  /** Uniform in [0, 1). Defaults to `Math.random`; tests pass their own. */
  random?: () => number
}

export const SAMPLE_PREFIX = '[ai-sample]'

/** Share of default-locale (English) calls that are logged (HON-903). */
export const DEFAULT_LOCALE_SAMPLE_RATE = 0.05

export async function logAiSample(sample: AiSampleInput): Promise<void> {
  try {
    const sampleRate = isDefaultLocale(sample.locale) ? DEFAULT_LOCALE_SAMPLE_RATE : 1
    if (sampleRate < 1 && (sample.random ?? Math.random)() >= sampleRate) return

    const payload = {
      type: 'ai_sample',
      timestamp: new Date().toISOString(),
      callSite: sample.callSite,
      locale: sample.locale,
      sampleRate,
      input: sample.input,
      output: sample.output,
    }

    const line = JSON.stringify(payload)
    console.info(`${SAMPLE_PREFIX} ${line}`)

    if (process.env.NODE_ENV !== 'production') {
      await writeDevSample(line)
    }
  } catch (error) {
    console.error(`${SAMPLE_PREFIX} Failed to log sample:`, error)
  }
}

async function writeDevSample(line: string): Promise<void> {
  try {
    const dir = path.join(process.cwd(), '.ai-samples')
    await mkdir(dir, { recursive: true })
    const date = new Date().toISOString().slice(0, 10)
    const file = path.join(dir, `${date}.jsonl`)
    await appendFile(file, `${line}\n`, 'utf-8')
  } catch {
    // Filesystem may be read-only (e.g. Vercel build). Swallow silently;
    // the stdout log is still captured.
  }
}
