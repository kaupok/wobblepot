import { describe, expect, it } from 'vitest'
import {
  buildJobs,
  buildJudgePrompt,
  buildPrompt,
  computePass,
  costFromUsage,
  estimateTotalUsd,
  extensionFor,
  ingredientsByQuantity,
  JUDGE_EST_USD,
  judgeSummary,
  MEALS,
  MODELS,
  parseArgs,
  passRates,
  PREP_EST_USD,
  renderContactSheet,
  STYLES,
  summarize,
  thinkingTokensFrom,
  V2_EXCLUSIONS,
  variantsFor,
  type JobResult,
  type JudgeResult,
  type PrepSample,
  type SpikeMeal,
} from './spike-meal-images'

const defaultArgs = parseArgs([])
const illustration = STYLES.find((s) => s.id === 'illustration')!
const photo = STYLES.find((s) => s.id === 'photo')!
const meal = (slug: string): SpikeMeal => MEALS.find((m) => m.slug === slug)!

const judge = (over: Partial<JudgeResult> = {}): JudgeResult => ({
  extraIngredients: [],
  missingIngredients: [],
  prepContradictions: [],
  pass: true,
  latencyMs: 8_000,
  usd: 0.01,
  ...over,
})

const ok = (over: Partial<JobResult> = {}): JobResult => ({
  modelKey: 'flare',
  mealSlug: 'greek-salad',
  styleId: 'illustration',
  version: 'v1',
  prompt: 'p',
  latencyMs: 10_000,
  file: 'flare/greek-salad-illustration-v1.png',
  usd: 0.05,
  costMeasured: true,
  ...over,
})

const prep: PrepSample = {
  mealSlug: 'ratatouille',
  kind: 'full',
  equipment: ['Large sauté pan'],
  steps: ['Dice the eggplant into 2cm cubes', 'Simmer everything for 30 minutes'],
  pitfalls: [],
  tip: 'Salt the eggplant first',
  latencyMs: 5_000,
  usd: 0.01,
}

describe('buildPrompt v1', () => {
  it('is byte-identical to the HON-717 prompt', () => {
    // Copied from the HON-717 run's results.json (flare · beetroot-gratin · illustration).
    expect(buildPrompt(meal('beetroot-gratin'), illustration, 'v1')).toBe(
      'Warm stylised illustration of a home-cooked dish, soft gouache textures, gentle hand-drawn linework, muted natural palette, seen from a three-quarter angle. The dish: Miso-glazed Beetroot & Rhubarb Gratin — Layered beetroot and rhubarb baked under a white miso cream, finished with toasted buckwheat. Key ingredients: beetroot, rhubarb, white miso, heavy cream, buckwheat, thyme. A single dish, landscape 3:2 composition with the food filling the frame. No text, no labels, no logos, no hands, no people.',
    )
  })
})

describe('buildPrompt v2', () => {
  const v2 = (slug: string) => buildPrompt(meal(slug), illustration, 'v2')

  it('asks for one served portion with nothing around it', () => {
    const prompt = v2('lamb-stew')
    expect(prompt.startsWith(illustration.prefixV2!)).toBe(true)
    expect(prompt).toContain('one served portion')
    expect(prompt).toContain(V2_EXCLUSIONS)
  })

  it('drops the bare "Key ingredients:" line that drew raw-ingredient props', () => {
    for (const m of MEALS) expect(v2(m.slug)).not.toContain('Key ingredients:')
  })

  it('lists every ingredient, largest amount first', () => {
    const stew = meal('lamb-stew')
    expect(ingredientsByQuantity(stew)).toEqual([
      'beef stock',
      'lamb shank',
      'potato',
      'carrot',
      'onion',
      'thyme',
    ])
    expect(v2('lamb-stew')).toContain(
      'largest amount first: beef stock, lamb shank, potato, carrot, onion, thyme.',
    )
  })

  it('includes preparationNotes only for a meal that has them', () => {
    const withNotes = MEALS.filter((m) => m.preparationNotes)
    expect(withNotes.map((m) => m.slug)).toEqual(['chicken-thighs'])
    expect(v2('chicken-thighs')).toContain(
      `How it is prepared: ${meal('chicken-thighs').preparationNotes}`,
    )
    expect(v2('ratatouille')).not.toContain('How it is prepared')
  })

  it('refuses a style without a V2 prefix', () => {
    expect(() => buildPrompt(meal('greek-salad'), photo, 'v2')).toThrow(/no V2 prefix/)
  })
})

describe('parseArgs / buildJobs', () => {
  it('is a dry run by default over flare + sunburst × illustration v1/v2 × 6 meals', () => {
    expect(defaultArgs.confirm).toBe(false)
    expect(defaultArgs.judge).toBe(true)
    const jobs = buildJobs(defaultArgs)
    expect(jobs).toHaveLength(24)
    expect(new Set(jobs.map((j) => j.model.key))).toEqual(new Set(['flare', 'sunburst']))
    expect(new Set(jobs.map((j) => j.style.id))).toEqual(new Set(['illustration']))
    expect(new Set(jobs.map((j) => j.version))).toEqual(new Set(['v1', 'v2']))
  })

  it('arms spending only on --confirm and skips the judge on --no-judge', () => {
    expect(parseArgs(['--confirm']).confirm).toBe(true)
    expect(parseArgs(['--no-judge']).judge).toBe(false)
  })

  it('still reaches the HON-717 models and styles with explicit flags', () => {
    const args = parseArgs(['--models=nano-banana-2', '--styles=photo,flat', '--versions=v1'])
    expect(buildJobs(args)).toHaveLength(MEALS.length * 2)
  })

  it('rejects v2 for a style that has no V2 prefix', () => {
    expect(() => parseArgs(['--styles=photo'])).toThrow(/v2 is defined only for illustration/)
    expect(() => parseArgs(['--versions=v2', '--styles=photo'])).toThrow(/not photo/)
  })

  it('rejects an unknown model, style or version rather than silently running nothing', () => {
    expect(() => parseArgs(['--models=dall-e'])).toThrow(/Unknown model/)
    expect(() => parseArgs(['--styles=oil-painting'])).toThrow(/Unknown style/)
    expect(() => parseArgs(['--versions=v3'])).toThrow(/Unknown version/)
  })
})

describe('estimateTotalUsd', () => {
  const jobs = buildJobs(defaultArgs)
  const images = jobs.reduce((sum, j) => sum + j.model.estPerImageUsd, 0)

  it('adds one judge call per image and one prep call per meal', () => {
    expect(estimateTotalUsd(jobs, { judge: true })).toBeCloseTo(
      images + 24 * JUDGE_EST_USD + MEALS.length * PREP_EST_USD,
    )
  })

  it('prices images alone with --no-judge', () => {
    expect(estimateTotalUsd(jobs, { judge: false })).toBeCloseTo(images)
    expect(images).toBeCloseTo(MODELS[0]!.estPerImageUsd * 24)
  })
})

describe('buildJudgePrompt', () => {
  it('gives the judge every ingredient and the prep steps it must not contradict', () => {
    const prompt = buildJudgePrompt(meal('ratatouille'), prep)
    for (const c of meal('ratatouille').components) expect(prompt).toContain(`- ${c.name}: `)
    expect(prompt).toContain('1. Dice the eggplant into 2cm cubes')
    expect(prompt).toContain('Equipment: Large sauté pan')
    expect(prompt).not.toContain("cook's own preparation notes")
  })

  it('includes the notes when the meal has them', () => {
    const prompt = buildJudgePrompt(meal('chicken-thighs'), undefined)
    expect(prompt).toContain(meal('chicken-thighs').preparationNotes)
  })

  it('says no method is known when there are neither notes nor prep', () => {
    expect(buildJudgePrompt(meal('greek-salad'), { ...prep, error: 'boom' })).toContain(
      'No preparation method is known.',
    )
  })
})

describe('computePass / passRates / judgeSummary', () => {
  it('passes only when all three finding lists are empty', () => {
    const empty = { extraIngredients: [], missingIngredients: [], prepContradictions: [] }
    expect(computePass(empty)).toBe(true)
    expect(computePass({ ...empty, extraIngredients: ['olives'] })).toBe(false)
    expect(computePass({ ...empty, missingIngredients: ['feta'] })).toBe(false)
    expect(computePass({ ...empty, prepContradictions: ['steps: diced; image: rings'] })).toBe(
      false,
    )
  })

  it('counts per model × version and leaves failed images and judge errors unjudged', () => {
    const rates = passRates([
      ok({ judge: judge() }),
      ok({ judge: judge({ pass: false }) }),
      ok({ judgeError: 'overloaded' }),
      ok({ error: 'boom', file: undefined }),
      ok({ version: 'v2', judge: judge() }),
    ])
    expect(rates).toEqual([
      { model: 'flare', version: 'v1', judged: 2, passed: 1, ratePct: 50 },
      { model: 'flare', version: 'v2', judged: 1, passed: 1, ratePct: 100 },
    ])
  })

  it("summarises the judge's own cost and latency", () => {
    expect(
      judgeSummary([
        ok({ judge: judge({ latencyMs: 6_000, usd: 0.01 }) }),
        ok({ judge: judge({ latencyMs: 10_000, usd: 0.03 }) }),
        ok({ judgeError: 'x' }),
      ]),
    ).toEqual({
      judged: 2,
      errors: 1,
      meanLatencyS: 8,
      maxLatencyS: 10,
      meanUsd: 0.02,
      totalUsd: 0.04,
    })
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
      version: 'v1',
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
  const models = MODELS.filter((m) => defaultArgs.models.includes(m.key))
  const meta = { startedAt: '2026-09-21T00:00:00Z', models, variants: variantsFor(defaultArgs) }

  it('renders one meal × variant table per model', () => {
    const html = renderContactSheet([ok()], meta)
    expect(html.match(/<section>/g)).toHaveLength(2)
    expect(html.match(/<tr><th scope="row">/g)).toHaveLength(2 * MEALS.length)
    expect(html).toContain('Stylised illustration V1')
    expect(html).toContain('Stylised illustration V2')
    expect(html).toContain('<img src="flare/greek-salad-illustration-v1.png"')
  })

  it("shows the judge's verdict and escaped findings in the cell", () => {
    const html = renderContactSheet(
      [
        ok({
          judge: judge({
            pass: false,
            extraIngredients: ['<b>olives</b>'],
            prepContradictions: ['steps: diced; image: rings'],
          }),
        }),
      ],
      meta,
    )
    expect(html).toContain('>FAIL</span>')
    expect(html).toContain('&lt;b&gt;olives&lt;/b&gt;')
    expect(html).toContain('steps: diced; image: rings')
    expect(html).toContain('<td>0/1</td><td>0%</td>')
  })

  it('shows the error instead of an image for a failed cell, escaped', () => {
    const html = renderContactSheet(
      [ok({ error: '<b>quota</b>', file: undefined, usd: undefined })],
      meta,
    )
    expect(html).toContain('&lt;b&gt;quota&lt;/b&gt;')
    expect(html).not.toContain('<img')
  })

  it('lists the prep sample with the meal notes', () => {
    const html = renderContactSheet([], {
      ...meta,
      prep: [{ ...prep, mealSlug: 'chicken-thighs', kind: 'supplementary', steps: [] }],
    })
    expect(html).toContain('Baked Chicken Thighs (supplementary)')
    expect(html).toContain('Notes: Cut the potatoes into 2cm cubes')
  })

  it('escapes meal names', () => {
    expect(renderContactSheet([], meta)).toContain('Miso-glazed Beetroot &amp; Rhubarb Gratin')
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
