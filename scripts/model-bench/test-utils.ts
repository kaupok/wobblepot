/**
 * Test-only helpers for the model benchmark: a `MockLanguageModelV4` factory
 * whose responses are chosen per call, and the starter case set. Imported by
 * `*.test.ts` only — no test in this directory touches the network.
 */

import { copyFileSync, mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MockLanguageModelV4 } from 'ai/test'
import type { BenchCase, Task } from './case-schema'
import { CASES_DIR, loadCases } from './load-cases'
import type { ModelFactory } from './runner'

/**
 * The HON-795 starter set: one English and one Estonian case per task. The
 * harness tests run on these rather than on all of `cases/`, so their call
 * counts do not change each time a case is added (HON-797).
 */
export const STARTER_CASE_IDS: readonly string[] = [
  'plan/en-week-no-diet',
  'plan/et-vegetarian-weekend-lunch',
  'recipe/en-carbonara',
  'recipe/et-hakklihakaste',
  'imagine/en-chicken-rice-weeknight',
  'imagine/et-vegetarian-lentils',
  'review/en-chicken-stir-fry',
  'review/et-kartulisalat',
  'tips/en-full-bolognese',
  'tips/et-supplementary-ahjulohe',
]

/** Throws if a starter case is missing, so a renamed file cannot shrink a test's input. */
export function loadStarterCases(tasks: readonly Task[]): BenchCase[] {
  const cases = loadCases(tasks).filter((c) => STARTER_CASE_IDS.includes(c.id))
  const wanted = STARTER_CASE_IDS.filter((id) => tasks.some((t) => id.startsWith(`${t}/`)))
  const missing = wanted.filter((id) => !cases.some((c) => c.id === id))
  if (missing.length > 0) throw new Error(`Starter cases not found: ${missing.join(', ')}`)
  return cases
}

/** A temporary cases directory holding only the starter set. The caller removes it. */
export function starterCasesDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'model-bench-cases-'))
  for (const id of STARTER_CASE_IDS) {
    const [task, name] = id.split('/') as [string, string]
    mkdirSync(join(dir, task), { recursive: true })
    copyFileSync(join(CASES_DIR, task, `${name}.json`), join(dir, task, `${name}.json`))
  }
  return dir
}

// `@ai-sdk/provider` is not a direct dependency, so take its spec types from the mock.
type LanguageModelV4CallOptions = Parameters<MockLanguageModelV4['doGenerate']>[0]
type LanguageModelV4GenerateResult = Awaited<ReturnType<MockLanguageModelV4['doGenerate']>>

export interface MockResponse {
  /** Serialized as the model's JSON text. Ignored when `text` is set. */
  object?: unknown
  /** Raw text, e.g. deliberately truncated JSON. */
  text?: string
  finishReason?: 'stop' | 'length'
  inputTokens?: number
  outputTokens?: number
  reasoningTokens?: number
}

export interface MockCall {
  modelId: string
  options: LanguageModelV4CallOptions
  /** Every text part of the prompt, joined — what the responder matches on. */
  promptText: string
}

export function promptTextOf(options: LanguageModelV4CallOptions): string {
  return options.prompt
    .flatMap((message) =>
      typeof message.content === 'string'
        ? [message.content]
        : message.content.flatMap((part) => (part.type === 'text' ? [part.text] : [])),
    )
    .join('\n')
}

function toResult(r: MockResponse): LanguageModelV4GenerateResult {
  const input = r.inputTokens ?? 1_000
  const output = r.outputTokens ?? 500
  return {
    content: [{ type: 'text', text: r.text ?? JSON.stringify(r.object) }],
    finishReason: { unified: r.finishReason ?? 'stop', raw: undefined },
    usage: {
      inputTokens: { total: input, noCache: input, cacheRead: 0, cacheWrite: 0 },
      outputTokens: {
        total: output,
        text: output - (r.reasoningTokens ?? 0),
        reasoning: r.reasoningTokens,
      },
    },
    warnings: [],
  }
}

/**
 * A `ModelFactory` backed by `MockLanguageModelV4`. `respond` picks the reply
 * for each call; `calls` records every call in order.
 */
export function mockModelFactory(respond: (call: MockCall) => MockResponse): {
  factory: ModelFactory
  calls: MockCall[]
} {
  const calls: MockCall[] = []
  const factory: ModelFactory = (modelId) =>
    new MockLanguageModelV4({
      modelId,
      doGenerate: async (options) => {
        const call = { modelId, options, promptText: promptTextOf(options) }
        calls.push(call)
        return toResult(respond(call))
      },
    })
  return { factory, calls }
}
