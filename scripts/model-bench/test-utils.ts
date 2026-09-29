/**
 * Test-only helpers for the model benchmark: a `MockLanguageModelV4` factory
 * whose responses are chosen per call. Imported by `*.test.ts` only — no test
 * in this directory touches the network.
 */

import { MockLanguageModelV4 } from 'ai/test'
import type { ModelFactory } from './runner'

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
