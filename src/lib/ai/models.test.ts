// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { createAnthropic } from '@ai-sdk/anthropic'
import { generateObject } from 'ai'
import { z } from 'zod'
import {
  PLANNING_MODEL,
  RECIPE_MODEL,
  TIPS_MODEL,
  IMAGINE_MODEL,
  REVIEW_MODEL,
  COOK_QUESTION_MODEL,
} from './models'

/**
 * Sonnet 5.5 rejects forced tool use (`tool_choice` `any` / `tool`) with a 400
 * (HON-794). Every call site is `generateObject`, which is safe only while
 * `@ai-sdk/anthropic` sends native structured output (`output_config.format`)
 * for the model. The provider decides that by substring-matching the model ID
 * in `getModelCapabilities`; if it stops recognising a constant here, it falls
 * back to a forced JSON tool and every AI feature 400s in production. This
 * pins the request shape against the real provider, with only `fetch` mocked.
 */
async function captureRequestBody(modelId: string): Promise<Record<string, unknown>> {
  const fetch = vi.fn<typeof globalThis.fetch>(async () =>
    Response.json({
      id: 'msg_test',
      type: 'message',
      role: 'assistant',
      model: modelId,
      content: [{ type: 'text', text: '{"name":"Soup"}' }],
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 5 },
    }),
  )
  const anthropic = createAnthropic({ apiKey: 'test-key', fetch })

  const { object } = await generateObject({
    model: anthropic(modelId),
    schema: z.object({ name: z.string() }),
    prompt: 'Name a meal.',
    maxRetries: 0,
  })

  expect(object).toEqual({ name: 'Soup' })
  expect(fetch).toHaveBeenCalledTimes(1)
  return JSON.parse(fetch.mock.calls[0]![1]!.body as string) as Record<string, unknown>
}

describe('AI model constants', () => {
  it.each([
    ['PLANNING_MODEL', PLANNING_MODEL],
    ['RECIPE_MODEL', RECIPE_MODEL],
    ['TIPS_MODEL', TIPS_MODEL],
    ['IMAGINE_MODEL', IMAGINE_MODEL],
    ['REVIEW_MODEL', REVIEW_MODEL],
    ['COOK_QUESTION_MODEL', COOK_QUESTION_MODEL],
  ])('%s gets native structured output, not a forced JSON tool', async (_name, modelId) => {
    const body = await captureRequestBody(modelId)

    expect(body.model).toBe(modelId)
    expect(body).toHaveProperty('output_config.format')
    expect(body).not.toHaveProperty('tool_choice')
    expect(body).not.toHaveProperty('tools')
  })
})
