import { describe, expect, it } from 'vitest'
import {
  buildJobs,
  buildPrompt,
  costFromUsage,
  estimateTotalUsd,
  extensionFor,
  MEALS,
  MODELS,
  parseArgs,
  renderContactSheet,
  STYLES,
  summarize,
  thinkingTokensFrom,
  type JobResult,
} from './spike-meal-images'

const allArgs = parseArgs([])

const ok = (over: Partial<JobResult> = {}): JobResult => ({
  modelKey: 'flare',
  mealSlug: 'bolognese',
  styleId: 'photo',
  prompt: 'p',
  latencyMs: 10_000,
  file: 'flare/bolognese-photo.png',
  usd: 0.05,
  costMeasured: true,
  ...over,
})

describe('buildPrompt', () => {
  it('leads with the style prefix and names the meal and every ingredient', () => {
    const meal = MEALS[0]!
    const style = STYLES[1]!
    const prompt = buildPrompt(meal, style)
    expect(prompt.startsWith(style.prefix)).toBe(true)
    expect(prompt).toContain(meal.name)
    expect(prompt).toContain(meal.description)
    for (const ingredient of meal.ingredients) expect(prompt).toContain(ingredient)
  })
})

describe('parseArgs / buildJobs', () => {
  it('is a dry run without --confirm and defaults to the full 36-job matrix', () => {
    expect(allArgs.confirm).toBe(false)
    expect(buildJobs(allArgs)).toHaveLength(36)
  })

  it('arms spending only on --confirm', () => {
    expect(parseArgs(['--confirm']).confirm).toBe(true)
  })

  it('narrows the matrix with --models and --styles', () => {
    const args = parseArgs(['--models=nano-banana-2', '--styles=photo,flat'])
    const jobs = buildJobs(args)
    expect(jobs).toHaveLength(4 * 2)
    expect(new Set(jobs.map((j) => j.model.key))).toEqual(new Set(['nano-banana-2']))
  })

  it('rejects an unknown model or style rather than silently running nothing', () => {
    expect(() => parseArgs(['--models=dall-e'])).toThrow(/Unknown model/)
    expect(() => parseArgs(['--styles=oil-painting'])).toThrow(/Unknown style/)
  })
})

describe('estimateTotalUsd', () => {
  it('sums the per-model estimate over every job', () => {
    const perModel = MODELS.reduce((sum, m) => sum + m.estPerImageUsd, 0)
    expect(estimateTotalUsd(buildJobs(allArgs))).toBeCloseTo(perModel * 12)
  })
})

describe('costFromUsage', () => {
  const rate = { inputPerM: 5, outputPerM: 30 }

  it('prices measured tokens', () => {
    const cost = costFromUsage({ inputTokens: 200, outputTokens: 1_000 }, rate, 0.05)
    expect(cost.measured).toBe(true)
    expect(cost.usd).toBeCloseTo((200 * 5 + 1_000 * 30) / 1_000_000)
  })

  it('prices thinking tokens at their own rate when the count is known', () => {
    const gemini = { inputPerM: 0.5, outputPerM: 60, thinkingPerM: 3 }
    const cost = costFromUsage({ inputTokens: 100, outputTokens: 1_570 }, gemini, 0.067, 450)
    expect(cost.measured).toBe(true)
    expect(cost.usd).toBeCloseTo((100 * 0.5 + 1_120 * 60 + 450 * 3) / 1_000_000)
  })

  it('labels the all-image-rate price as not measured when the thinking count is missing', () => {
    const gemini = { inputPerM: 0.5, outputPerM: 60, thinkingPerM: 3 }
    const cost = costFromUsage({ inputTokens: 100, outputTokens: 1_570 }, gemini, 0.067)
    expect(cost.measured).toBe(false)
    expect(cost.usd).toBeCloseTo((100 * 0.5 + 1_570 * 60) / 1_000_000)
  })

  it('falls back to the labelled estimate when the provider reports no output tokens', () => {
    expect(costFromUsage(undefined, rate, 0.05)).toEqual({ usd: 0.05, measured: false })
    expect(
      costFromUsage(
        { inputTokens: 10, outputTokens: undefined, totalTokens: undefined },
        rate,
        0.05,
      ),
    ).toEqual({ usd: 0.05, measured: false })
  })
})

describe('summarize', () => {
  it('splits failures from successes and averages only the successes', () => {
    const [flare] = summarize([
      ok({ latencyMs: 10_000, usd: 0.04 }),
      ok({ latencyMs: 20_000, usd: 0.06, costMeasured: false }),
      ok({ error: 'boom', file: undefined, usd: undefined }),
    ])
    expect(flare).toMatchObject({
      model: 'flare',
      ok: 2,
      failed: 1,
      meanLatencyS: 15,
      minLatencyS: 10,
      maxLatencyS: 20,
      meanUsd: 0.05,
      totalUsd: 0.1,
      cost: 'mixed',
    })
  })
})

describe('renderContactSheet', () => {
  const meta = { startedAt: '2026-09-21T00:00:00Z', models: MODELS, styles: STYLES }

  it('renders one meal × style table per model', () => {
    const html = renderContactSheet([ok()], meta)
    expect(html.match(/<section>/g)).toHaveLength(MODELS.length)
    expect(html.match(/<tr><th scope="row">/g)).toHaveLength(MODELS.length * MEALS.length)
    expect(html).toContain('<img src="flare/bolognese-photo.png"')
  })

  it('shows the error instead of an image for a failed cell, escaped', () => {
    const html = renderContactSheet(
      [ok({ error: '<b>quota</b>', file: undefined, usd: undefined })],
      meta,
    )
    expect(html).toContain('&lt;b&gt;quota&lt;/b&gt;')
    expect(html).not.toContain('<img')
  })

  it('escapes meal names', () => {
    const html = renderContactSheet([], meta)
    expect(html).toContain('Miso-glazed Beetroot &amp; Rhubarb Gratin')
  })
})

describe('extensionFor', () => {
  it('names files after the returned media type, not the requested one', () => {
    expect(extensionFor('image/png')).toBe('png')
    expect(extensionFor('image/jpeg')).toBe('jpg')
    expect(extensionFor('image/webp')).toBe('webp')
  })
})

describe('thinkingTokensFrom', () => {
  it("reads Gemini's thoughtsTokenCount from provider metadata", () => {
    expect(thinkingTokensFrom({ google: { usageMetadata: { thoughtsTokenCount: 450 } } })).toBe(450)
  })

  it('is undefined when the provider reports no thinking count', () => {
    expect(thinkingTokensFrom(undefined)).toBeUndefined()
    expect(thinkingTokensFrom({ openai: {} })).toBeUndefined()
    expect(thinkingTokensFrom({ google: { usageMetadata: {} } })).toBeUndefined()
  })
})
