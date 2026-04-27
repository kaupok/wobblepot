/**
 * Lightweight AI output sampling for ongoing voice review (HON-504).
 *
 * `logAiSample` is the single entry point. Call it after every successful
 * `generateObject` invocation against an AI call site that may produce
 * non-English output. Behaviour:
 *
 *   - English (default locale) calls are NEVER logged. English output is
 *     considered "known good" and out of scope per HON-504.
 *   - Non-default locale calls emit a single structured JSON line to stdout
 *     prefixed with `[ai-sample]`. Vercel captures stdout to log streams,
 *     so this is queryable in staging/prod without any new infrastructure.
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
}

const SAMPLE_PREFIX = '[ai-sample]'

export async function logAiSample(sample: AiSampleInput): Promise<void> {
  try {
    if (isDefaultLocale(sample.locale)) return

    const payload = {
      type: 'ai_sample',
      timestamp: new Date().toISOString(),
      callSite: sample.callSite,
      locale: sample.locale,
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
