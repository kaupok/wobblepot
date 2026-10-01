// @vitest-environment node
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MODEL_PRICES } from '../../src/lib/ai/pricing'
import { main, type MainDeps } from './run'
import { mockModelFactory, starterCasesDir, type MockCall, type MockResponse } from './test-utils'

const BASE_ARGS = ['--baseline', 'claude-sonnet-5', '--candidate', 'claude-sonnet-5-5']
const STEM = '2026-10-01-claude-sonnet-5-vs-claude-sonnet-5-5'

/**
 * A plausible reply for every task, chosen by a phrase only that task's
 * prompt carries. The pipeline test checks the plumbing, not model quality.
 */
function respond({ promptText }: MockCall): MockResponse {
  if (promptText.includes('You are judging two answers')) {
    return { object: { winner: 'tie', reason: 'Neither is better.' } }
  }
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
    // The console echo carries all three lists and stops before the tables.
    const echoed = out.join('\n')
    expect(echoed).toContain('## Other changes outside noise')
    expect(echoed).toContain('## Within noise')
    expect(echoed).not.toContain('## plan')

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

  it('adds two judge calls per imagine and tips case and run under --dry-run --judge-api', async () => {
    const code = await main([...BASE_ARGS, '--dry-run', '--judge-api'], deps)

    expect(code).toBe(0)
    const text = out.join('\n')
    // 60 benchmark calls, plus 4 judged starter cases × 3 runs × 2 orders.
    expect(text).toContain('Total calls: 84')
    expect(text).toMatch(/claude-opus-5-5 \(judge\): 24 calls, .*~\$\d+\.\d\d/)
  })

  it('adds no API call under --dry-run --judge, and says how many prompts go to Claude Code', async () => {
    const code = await main([...BASE_ARGS, '--dry-run', '--judge'], deps)

    expect(code).toBe(0)
    const text = out.join('\n')
    expect(text).toContain('Total calls: 60')
    expect(text).toContain('judge: 12 pairs, 24 prompts, exported for Claude Code')
    expect(text).not.toContain('claude-opus-5-5')
  })

  it('warns under --dry-run when the estimate is above --max-usd', async () => {
    await main([...BASE_ARGS, '--dry-run', '--judge-api', '--max-usd', '0.01'], deps)
    expect(out.join('\n')).toContain('The estimate is above --max-usd 0.01')
  })

  it('exports blind judge pairs with --judge, and folds the verdicts back in with --import-verdicts', async () => {
    const { factory, calls } = mockModelFactory(respond)
    const argv = [...BASE_ARGS, '--runs', '1', '--task', 'imagine,tips', '--judge']
    expect(await main(argv, { ...deps, modelFactory: factory })).toBe(0)
    // 4 cases × 2 models, and not one judge call.
    expect(calls).toHaveLength(8)

    const pairsPath = join(outDir, `${STEM}.judge-pairs.json`)
    expect(out.join('\n')).toContain(`Judge pairs: ${relative(process.cwd(), pairsPath)}`)
    const pairs = JSON.parse(readFileSync(pairsPath, 'utf8'))
    expect(pairs.verdictsFile).toBe(`${STEM}.judge-verdicts.json`)
    // The file is named after the run, but the prompts name no model or role.
    for (const secret of ['claude-sonnet', 'baseline', 'candidate']) {
      expect(JSON.stringify(pairs.items)).not.toContain(secret)
    }
    // 4 pairs × 2 orders.
    expect(pairs.items).toHaveLength(8)
    expect(pairs.items[0]).toMatchObject({
      id: expect.stringMatching(/^imagine\/en-chicken-rice-weeknight#1#[ab]$/),
      task: 'imagine',
    })
    expect(pairs.items[0].system).toContain('You are judging two answers')
    expect(pairs.items[0].prompt).toContain('<answer_a>')

    let md = readFileSync(join(outDir, `${STEM}.md`), 'utf8')
    expect(md).toContain('**Pending.** 4 pair(s), 8 prompt(s)')
    const key = JSON.parse(readFileSync(join(outDir, `${STEM}.json`), 'utf8')).judgeKey
    expect(key.pairs).toHaveLength(4)
    expect(key.pairs[0].items.map((i: { roleAsA: string }) => i.roleAsA)).toEqual([
      'baseline',
      'candidate',
    ])

    // Pick the candidate in both orders of the imagine pairs, leave one tips
    // pair unjudged and tie the other.
    const verdicts = key.pairs.flatMap(
      (p: { task: string; items: { id: string; roleAsA: string }[] }) =>
        p.items.map((i) => ({
          id: i.id,
          winner: p.task === 'imagine' ? (i.roleAsA === 'candidate' ? 'A' : 'B') : 'tie',
          reason: 'Because.',
        })),
    )
    const verdictsPath = join(outDir, pairs.verdictsFile)
    writeFileSync(
      verdictsPath,
      JSON.stringify({ judge: 'claude-code/opus', verdicts: verdicts.slice(0, -2) }),
    )
    out = []
    expect(await main(['--import-verdicts', verdictsPath], deps)).toBe(0)

    md = readFileSync(join(outDir, `${STEM}.md`), 'utf8')
    expect(md).not.toContain('**Pending.**')
    expect(md).toContain('claude-code/opus compared the two models')
    expect(md).toContain('| imagine | 2 | 0 | 0 | 0 | 0 | too few decided pairs (2 of 5) |')
    expect(md).toContain('| tips | 0 | 1 | 0 | 0 | 1 | too few decided pairs (0 of 5) |')
    expect(out.join('\n')).toContain('1 pair(s) had a verdict missing')
    expect(out.join('\n')).toContain('## Judge')

    const json = JSON.parse(readFileSync(join(outDir, `${STEM}.json`), 'utf8'))
    expect(json.judge.model).toBe('claude-code/opus')
    expect(json.judge.pairs).toHaveLength(4)
    expect(json.calls).toHaveLength(8)
    // The key survives, so the run can be judged again.
    expect(json.judgeKey.pairs).toHaveLength(4)
    expect(existsSync(pairsPath)).toBe(true)
  })

  it('refuses verdicts for ids the run never exported', async () => {
    const { factory } = mockModelFactory(respond)
    await main([...BASE_ARGS, '--runs', '1', '--task', 'tips', '--judge'], {
      ...deps,
      modelFactory: factory,
    })
    const verdictsPath = join(outDir, `${STEM}.judge-verdicts.json`)
    writeFileSync(
      verdictsPath,
      JSON.stringify({
        judge: 'claude-code/opus',
        verdicts: [{ id: 'imagine/other#1#a', winner: 'A', reason: 'r' }],
      }),
    )
    await expect(main(['--import-verdicts', verdictsPath], deps)).rejects.toThrow(
      /ids this run never exported: imagine\/other#1#a/,
    )
  })

  it('judges imagine and tips pairs with --judge-api and reports them', async () => {
    const { factory, calls } = mockModelFactory(respond)
    const code = await main(
      [...BASE_ARGS, '--runs', '1', '--task', 'imagine,tips,recipe', '--judge-api'],
      {
        ...deps,
        modelFactory: factory,
      },
    )

    expect(code).toBe(0)
    // 6 cases × 2 models, then 4 judged pairs × 2 orders.
    expect(calls).toHaveLength(12 + 8)
    expect(calls.slice(12).every((c) => c.modelId === 'claude-opus-5-5')).toBe(true)

    const md = readFileSync(join(outDir, `${STEM}.md`), 'utf8')
    expect(md).toContain('## Judge')
    expect(md).toContain('| imagine | 0 | 2 | 0 | 0 | 0 | too few decided pairs (0 of 5) |')
    expect(out.join('\n')).toContain('## Judge')

    const json = JSON.parse(readFileSync(join(outDir, `${STEM}.json`), 'utf8'))
    expect(json.judge.pairs).toHaveLength(4)
    expect(json.judge.pairs[0].calls.map((c: { reason: string }) => c.reason)).toEqual([
      'Neither is better.',
      'Neither is better.',
    ])
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

  it('with --judge-api, exits non-zero if the judge model has no MODEL_PRICES entry', async () => {
    const saved = MODEL_PRICES['claude-opus-5-5']
    delete MODEL_PRICES['claude-opus-5-5']
    try {
      const code = await main([...BASE_ARGS, '--dry-run', '--judge-api'], deps)
      expect(code).toBe(1)
      expect(err.join('\n')).toMatch(/No MODEL_PRICES entry for "claude-opus-5-5"/)
      // The Claude Code judge needs no price.
      expect(await main([...BASE_ARGS, '--dry-run', '--judge'], deps)).toBe(0)
    } finally {
      MODEL_PRICES['claude-opus-5-5'] = saved!
    }
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
    [[...BASE_ARGS, '--verbose'], /Unknown option '--verbose'/],
    [[...BASE_ARGS, '--judge', '--judge-api'], /--judge and --judge-api are alternatives/],
    [['--import-verdicts', 'results/run.json'], /takes a `\*\.judge-verdicts\.json` file/],
    [['--import-verdicts', 'nowhere/x.judge-verdicts.json'], /No verdicts file at/],
  ])('rejects bad arguments: %j', async (argv, message) => {
    const code = await main(argv, deps)
    expect(code).toBe(2)
    expect(err.join('\n')).toMatch(message)
  })
})
