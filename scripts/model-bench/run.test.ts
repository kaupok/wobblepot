// @vitest-environment node
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { main, type MainDeps } from './run'
import { mockModelFactory, starterCasesDir, type MockCall, type MockResponse } from './test-utils'

const BASE_ARGS = ['--baseline', 'claude-sonnet-5', '--candidate', 'claude-sonnet-5-5']
const STEM = '2026-10-01-claude-sonnet-5-vs-claude-sonnet-5-5'

/**
 * A plausible reply for every task, chosen by a phrase only that task's
 * prompt carries. The pipeline test checks the plumbing, not model quality.
 */
function respond({ promptText }: MockCall): MockResponse {
  if (promptText.includes('cooking quantity reviewer')) return { object: { ingredients: [] } }
  if (promptText.includes('creative home cooking assistant')) return { object: { meals: [] } }
  if (promptText.includes('recipe parsing assistant')) {
    return {
      object: {
        name: 'Recipe',
        description: null,
        preparationNotes: '1. Cook.',
        timeMinutes: 30,
        servings: 4,
        mealTypes: ['dinner'],
        kidFriendly: true,
        recipeConfidence: 90,
        ingredients: [
          {
            name: 'spaghetti',
            quantity: 400,
            unit: 'g',
            originalText: '400 g spaghetti',
            isVague: false,
            vaguePhrase: null,
            isDried: null,
          },
        ],
      },
    }
  }
  if (promptText.includes('supplementary tips'))
    return { object: { pitfalls: ['a', 'b'], tip: 't' } }
  if (promptText.includes('- equipment:')) {
    return {
      object: { equipment: ['a', 'b', 'c'], steps: ['1', '2', '3', '4'], pitfalls: ['a', 'b'] },
    }
  }
  return { object: { entries: [] } }
}

describe('main', () => {
  let outDir: string
  let casesDir: string
  let out: string[]
  let err: string[]
  let deps: MainDeps

  beforeEach(() => {
    outDir = mkdtempSync(join(tmpdir(), 'model-bench-results-'))
    casesDir = starterCasesDir()
    out = []
    err = []
    deps = {
      outDir,
      casesDir,
      log: (line) => out.push(line),
      error: (line) => err.push(line),
      today: () => new Date(2026, 9, 1),
      env: {},
    }
  })
  afterEach(() => {
    rmSync(outDir, { recursive: true, force: true })
    rmSync(casesDir, { recursive: true, force: true })
  })

  it('runs the whole pipeline on MockLanguageModelV4 and writes both reports', async () => {
    const { factory, calls } = mockModelFactory(respond)
    const code = await main([...BASE_ARGS, '--runs', '1'], { ...deps, modelFactory: factory })

    expect(code).toBe(0)
    // 10 starter cases × 1 run × 2 models.
    expect(calls).toHaveLength(20)

    const md = readFileSync(join(outDir, `${STEM}.md`), 'utf8')
    for (const task of ['plan', 'recipe', 'imagine', 'review', 'tips']) {
      expect(md).toContain(`## ${task}`)
    }
    expect(md).not.toContain('Partial run')
    // Identical mocks on both sides: nothing regresses or differs.
    expect(md).toMatch(/## Regressions\n\nNone\./)
    expect(md).toContain('**Total cost:**')

    const json = JSON.parse(readFileSync(join(outDir, `${STEM}.json`), 'utf8'))
    expect(json.calls).toHaveLength(20)
    expect(json.calls[0]).toMatchObject({ caseId: 'plan/en-week-no-diet', output: { entries: [] } })
    expect(json.partial).toBe(false)
  })

  it('never overwrites an earlier report from the same day', async () => {
    const { factory } = mockModelFactory(respond)
    const argv = [...BASE_ARGS, '--runs', '1', '--task', 'tips']
    await main(argv, { ...deps, modelFactory: factory })
    await main(argv, { ...deps, modelFactory: factory })

    expect(existsSync(join(outDir, `${STEM}.md`))).toBe(true)
    expect(existsSync(join(outDir, `${STEM}-2.md`))).toBe(true)
    expect(existsSync(join(outDir, `${STEM}-2.json`))).toBe(true)
  })

  it('stops at --max-usd on mocked usage and marks the written report partial', async () => {
    // 200k output tokens at $10 / MTok: $2 a call, so a $3 cap stops after two.
    const { factory, calls } = mockModelFactory((call) => ({
      ...respond(call),
      outputTokens: 200_000,
    }))
    const code = await main([...BASE_ARGS, '--runs', '1', '--max-usd', '3'], {
      ...deps,
      modelFactory: factory,
    })

    expect(code).toBe(0)
    expect(calls).toHaveLength(2)
    expect(err.join('\n')).toMatch(/Stopped early.*--max-usd 3/)
    const md = readFileSync(join(outDir, `${STEM}.md`), 'utf8')
    expect(md).toContain('**Partial run.**')
    expect(md).toContain('after 2 of 20 planned calls')
    expect(JSON.parse(readFileSync(join(outDir, `${STEM}.json`), 'utf8')).partial).toBe(true)
  })

  it('prints the call count and estimated cost under --dry-run without calling a model', async () => {
    const code = await main([...BASE_ARGS, '--dry-run'], {
      ...deps,
      modelFactory: () => {
        throw new Error('--dry-run must not build a model')
      },
    })

    expect(code).toBe(0)
    const text = out.join('\n')
    expect(text).toContain('Cases: 10')
    expect(text).toContain('Total calls: 60')
    expect(text).toMatch(/Estimated cost: ~\$\d+\.\d\d/)
    expect(existsSync(join(outDir, `${STEM}.md`))).toBe(false)
  })

  it('narrows the run with --task', async () => {
    await main([...BASE_ARGS, '--dry-run', '--task', 'recipe,tips', '--runs', '1'], deps)
    expect(out.join('\n')).toContain('Total calls: 8')
  })

  it('exits non-zero and names a model with no MODEL_PRICES entry, even under --dry-run', async () => {
    const code = await main(
      ['--baseline', 'claude-sonnet-5', '--candidate', 'not-a-model', '--dry-run'],
      deps,
    )
    expect(code).toBe(1)
    expect(err.join('\n')).toMatch(/No MODEL_PRICES entry for "not-a-model"/)
    expect(out).toEqual([])
  })

  it('refuses a real run without ANTHROPIC_API_KEY', async () => {
    const code = await main(BASE_ARGS, deps)
    expect(code).toBe(1)
    expect(err.join('\n')).toContain('ANTHROPIC_API_KEY is not set')
  })

  it.each([
    [['--baseline', 'claude-sonnet-5'], /--candidate are both required/],
    [[...BASE_ARGS, '--task', 'plan,dessert'], /Unknown --task dessert/],
    [[...BASE_ARGS, '--runs', '0'], /--runs must be a positive integer/],
    [[...BASE_ARGS, '--max-usd', 'lots'], /--max-usd must be a positive number/],
    [[...BASE_ARGS, '--judge'], /Unknown option '--judge'/],
  ])('rejects bad arguments: %j', async (argv, message) => {
    const code = await main(argv, deps)
    expect(code).toBe(2)
    expect(err.join('\n')).toMatch(message)
  })
})
