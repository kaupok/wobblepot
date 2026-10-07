// @vitest-environment node
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MODEL_PRICES } from '../../src/lib/ai/pricing'
import { IMAGINE_MODEL, STEPS_MODEL } from '../../src/lib/ai/models'
import { CASES_DIR } from './load-cases'
import { main, type MainDeps } from './run'
import { mockModelFactory, starterCasesDir, type MockCall, type MockResponse } from './test-utils'

/**
 * When on, the full-tips request carries an edited `pitfalls` `.describe()` and
 * nothing else changes: the shape of a schema-only prompt PR (HON-931).
 */
const tipsSchemaEdit = vi.hoisted(() => ({ on: false }))
vi.mock('../../src/lib/ai/preparation-steps', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/lib/ai/preparation-steps')>()
  return {
    ...mod,
    buildFullStepsRequest: (input: Parameters<typeof mod.buildFullStepsRequest>[0]) => {
      const request = mod.buildFullStepsRequest(input)
      if (!tipsSchemaEdit.on) return request
      const { pitfalls } = request.schema.shape
      return {
        ...request,
        schema: request.schema.extend({ pitfalls: pitfalls.describe('3-4 common mistakes') }),
      }
    },
  }
})

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
  if (promptText.includes('A home cook is in the middle of cooking')) {
    return { text: 'Use the Greek yogurt you have, stirred in off the heat.' }
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
  let goldenDir: string
  let out: string[]
  let err: string[]
  let deps: MainDeps

  beforeEach(() => {
    outDir = mkdtempSync(join(tmpdir(), 'model-bench-results-'))
    casesDir = starterCasesDir()
    // Never created up front: `--record` must make it.
    goldenDir = join(outDir, 'golden')
    out = []
    err = []
    deps = {
      outDir,
      casesDir,
      log: (line) => out.push(line),
      error: (line) => err.push(line),
      today: () => new Date(2026, 9, 1),
      goldenDir,
      commit: () => 'abc1234',
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
    // 12 starter cases × 1 run × 2 models.
    expect(calls).toHaveLength(24)

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
    expect(json.calls).toHaveLength(24)
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
    expect(md).toContain('after 2 of 24 planned calls')
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
    expect(text).toContain('Cases: 12')
    expect(text).toContain('Total calls: 72')
    expect(text).toMatch(/Estimated cost: ~\$\d+\.\d\d/)
    expect(existsSync(join(outDir, `${STEM}.md`))).toBe(false)
  })

  it('adds two judge calls per judged case and run under --dry-run --judge-api', async () => {
    const code = await main([...BASE_ARGS, '--dry-run', '--judge-api'], deps)

    expect(code).toBe(0)
    const text = out.join('\n')
    // 72 benchmark calls, plus 6 judged starter cases × 3 runs × 2 orders.
    expect(text).toContain('Total calls: 108')
    expect(text).toMatch(/claude-opus-5-5 \(judge\): 36 calls, .*~\$\d+\.\d\d/)
    // The rubric is cached: one write per locale, every later call reads it.
    expect(text).toMatch(/claude-opus-5-5 \(judge\): .*\+ ~\d+ cache write, ~\d+ cache read/)
  })

  it('adds no API call under --dry-run --judge, and says how many prompts go to Claude Code', async () => {
    const code = await main([...BASE_ARGS, '--dry-run', '--judge'], deps)

    expect(code).toBe(0)
    const text = out.join('\n')
    expect(text).toContain('Total calls: 72')
    expect(text).toContain('judge: 18 pairs, 36 prompts, exported for Claude Code')
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

  describe('--check', () => {
    const CHECK_STEM = '2026-10-01-check-production'

    it('runs each task on its production model once per case and run, and exits 0 when every gate holds', async () => {
      const { factory, calls } = mockModelFactory(respond)
      const code = await main(['--check', '--task', 'tips', '--runs', '2'], {
        ...deps,
        modelFactory: factory,
      })

      expect(code).toBe(0)
      // 2 tips starter cases × 2 runs, one model.
      expect(calls.map((c) => c.modelId)).toEqual(Array(4).fill(STEPS_MODEL))
      const md = readFileSync(join(outDir, `${CHECK_STEM}.md`), 'utf8')
      expect(md).toContain('# AI eval check: production configuration')
      expect(md).toContain(`Models: tips \`${STEPS_MODEL}\``)
      expect(md).toContain('| tips | Item counts in range | 100.0% | ≥ 90.0% | pass |')
      expect(out.join('\n')).toContain('**Pass.** All 3 gates hold.')
      const json = JSON.parse(readFileSync(join(outDir, `${CHECK_STEM}.json`), 'utf8'))
      expect(json).toMatchObject({ mode: 'check', model: null, passed: true, plannedCalls: 4 })
      expect(json.calls).toHaveLength(4)
    })

    it('runs every task on --model instead, and names the report after it', async () => {
      const { factory, calls } = mockModelFactory(respond)
      const code = await main(
        ['--check', '--model', 'claude-sonnet-5', '--task', 'tips', '--runs', '1'],
        { ...deps, modelFactory: factory },
      )

      expect(code).toBe(0)
      expect(new Set(calls.map((c) => c.modelId))).toEqual(new Set(['claude-sonnet-5']))
      const md = readFileSync(join(outDir, '2026-10-01-check-claude-sonnet-5.md'), 'utf8')
      expect(md).toContain('# AI eval check: claude-sonnet-5')
    })

    it('exits 1 when a gate fails, and the Gates table names the metric, the value and the threshold', async () => {
      // The mock imagines no meals at all.
      const { factory } = mockModelFactory(respond)
      const code = await main(['--check', '--task', 'imagine', '--runs', '1'], {
        ...deps,
        modelFactory: factory,
      })

      expect(code).toBe(1)
      const md = readFileSync(join(outDir, `${CHECK_STEM}.md`), 'utf8')
      expect(md).toContain('| imagine | Exactly 3 meals | 0.0% | ≥ 100.0% | **fail** |')
      expect(md).toContain(`Models: imagine \`${IMAGINE_MODEL}\``)
      expect(out.join('\n')).toMatch(/\*\*Fail\.\*\* \d+ of \d+ gates failed/)
    })

    it('passes a metric the case set never measures as "not measured"', async () => {
      // Only the not-a-recipe case: recall and precision have nothing to measure.
      const dir = mkdtempSync(join(tmpdir(), 'model-bench-cases-'))
      try {
        mkdirSync(join(dir, 'recipe'))
        const name = 'en-not-a-recipe-restaurant-review.json'
        copyFileSync(join(CASES_DIR, 'recipe', name), join(dir, 'recipe', name))
        const { factory } = mockModelFactory(() => ({
          object: {
            name: 'Not a recipe',
            description: null,
            preparationNotes: null,
            timeMinutes: null,
            servings: 1,
            mealTypes: [],
            kidFriendly: false,
            recipeConfidence: 5,
            ingredients: [],
          },
        }))
        const code = await main(['--check', '--task', 'recipe', '--runs', '1'], {
          ...deps,
          casesDir: dir,
          modelFactory: factory,
        })

        const md = readFileSync(join(outDir, `${CHECK_STEM}.md`), 'utf8')
        expect(md).toContain('| recipe | Ingredient recall | — | ≥ 95.0% | not measured |')
        expect(md).toContain('| recipe | Confidence tier agrees | 100.0% | ≥ 100.0% | pass |')
        expect(code).toBe(0)
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    })

    it('prints the production model per task and the estimate under --dry-run, calling nothing', async () => {
      const code = await main(['--check', '--dry-run'], {
        ...deps,
        modelFactory: () => {
          throw new Error('--dry-run must not build a model')
        },
      })

      expect(code).toBe(0)
      const text = out.join('\n')
      expect(text).toContain('Checking production configuration:')
      expect(text).toContain(`  tips: ${STEPS_MODEL}`)
      // 12 starter cases × 3 runs, one model.
      expect(text).toContain('Total calls: 36')
      expect(text).toMatch(/Estimated cost: ~\$\d+\.\d\d/)
      expect(existsSync(join(outDir, `${CHECK_STEM}.md`))).toBe(false)
    })

    it('accepts --model under --dry-run and prices it', async () => {
      expect(await main(['--check', '--model', 'claude-sonnet-5-5', '--dry-run'], deps)).toBe(0)
      expect(await main(['--check', '--model', 'not-a-model', '--dry-run'], deps)).toBe(1)
      expect(err.join('\n')).toMatch(/No MODEL_PRICES entry for "not-a-model"/)
    })

    it('is refused by --import-verdicts', async () => {
      const { factory } = mockModelFactory(respond)
      await main(['--check', '--task', 'tips', '--runs', '1'], { ...deps, modelFactory: factory })
      const verdictsPath = join(outDir, `${CHECK_STEM}.judge-verdicts.json`)
      writeFileSync(verdictsPath, JSON.stringify({ judge: 'claude-code/opus', verdicts: [] }))

      const code = await main(['--import-verdicts', verdictsPath], deps)
      expect(code).toBe(2)
      expect(err.join('\n')).toContain(`${CHECK_STEM}.json is a --check run`)
    })
  })

  describe('golden (HON-902)', () => {
    const GOLDEN_STEM = '2026-10-01-golden-vs-claude-sonnet-5'
    const COMPARE = ['--baseline', 'golden', '--candidate', 'claude-sonnet-5']
    const goldenFile = (task: string) =>
      JSON.parse(readFileSync(join(goldenDir, `${task}.json`), 'utf8'))
    const editGolden = (
      task: string,
      edit: (file: {
        commit?: string
        runs?: number
        cases: Record<string, { promptHash: string; requestHash?: string }>
      }) => void,
    ) => {
      const file = goldenFile(task)
      edit(file)
      writeFileSync(join(goldenDir, `${task}.json`), JSON.stringify(file))
    }

    /** Records imagine (whose gates the mock fails) and tips, two runs each. */
    async function recordImagineAndTips() {
      const { factory } = mockModelFactory(respond)
      await main(['--record', '--force', '--task', 'imagine,tips', '--runs', '2'], {
        ...deps,
        modelFactory: factory,
      })
      out = []
      err = []
    }

    it('--record writes one golden file per task with its provenance, prompt hashes and records', async () => {
      const { factory, calls } = mockModelFactory(respond)
      const code = await main(['--record', '--task', 'tips', '--runs', '2'], {
        ...deps,
        modelFactory: factory,
      })

      expect(code).toBe(0)
      expect(calls).toHaveLength(4)
      // The run's own report is written as under --check.
      expect(existsSync(join(outDir, '2026-10-01-check-production.md'))).toBe(true)
      expect(readdirSync(goldenDir)).toEqual(['tips.json'])

      const golden = goldenFile('tips')
      expect(golden).toMatchObject({
        task: 'tips',
        model: STEPS_MODEL,
        recordedAt: '2026-10-01',
        commit: 'abc1234',
        runs: 2,
      })
      expect(Object.keys(golden.cases)).toEqual([
        'tips/en-full-bolognese',
        'tips/et-supplementary-ahjulohe',
      ])
      const bolognese = golden.cases['tips/en-full-bolognese']
      expect(bolognese.promptHash).toMatch(/^[0-9a-f]{64}$/)
      expect(bolognese.calls.map((c: { run: number }) => c.run)).toEqual([1, 2])
      expect(bolognese.calls[0]).toMatchObject({
        caseId: 'tips/en-full-bolognese',
        model: STEPS_MODEL,
        output: { equipment: ['a', 'b', 'c'] },
      })
      expect(out.join('\n')).toContain(
        `Golden: ${relative(process.cwd(), join(goldenDir, 'tips.json'))}`,
      )
    })

    it('--record writes nothing and exits 1 when a gate fails, and --force records it anyway', async () => {
      const { factory } = mockModelFactory(respond)
      const argv = ['--record', '--task', 'imagine,tips', '--runs', '2']

      expect(await main(argv, { ...deps, modelFactory: factory })).toBe(1)
      expect(existsSync(goldenDir)).toBe(false)
      expect(err.join('\n')).toContain('Golden not recorded: a gate failed')

      // The check still fails, so the exit code stays 1; the golden is written.
      expect(await main([...argv, '--force'], { ...deps, modelFactory: factory })).toBe(1)
      expect(readdirSync(goldenDir).sort()).toEqual(['imagine.json', 'tips.json'])
      expect(out.join('\n')).toContain('Recording over failed gates (--force).')
    })

    it('--record still passes when one tips call returns an item count out of range (HON-929)', async () => {
      // A fourth pitfall on one supplementary call, as in the first HON-905 record.
      let supplementaryCalls = 0
      const { factory, calls } = mockModelFactory((call) => {
        if (call.promptText.includes('supplementary tips') && ++supplementaryCalls === 3) {
          return { object: { pitfalls: ['a', 'b', 'c', 'd'], tip: 't' } }
        }
        return respond(call)
      })
      const code = await main(['--record', '--task', 'tips', '--runs', '6'], {
        ...deps,
        modelFactory: factory,
      })

      expect(code).toBe(0)
      // 2 tips starter cases × 6 runs; 11 of 12 in range.
      expect(calls).toHaveLength(12)
      const md = readFileSync(join(outDir, '2026-10-01-check-production.md'), 'utf8')
      expect(md).toMatch(
        /\| tips \| Item counts in range \| 91\.7% \(50\.0%–100\.0%\) \| ≥ 90\.0% \| pass \|/,
      )
      expect(readdirSync(goldenDir)).toEqual(['tips.json'])
    })

    it('--record fails when one tips call errors, though the count gate tolerates a miss (HON-929)', async () => {
      let supplementaryCalls = 0
      const { factory } = mockModelFactory((call) => {
        if (call.promptText.includes('supplementary tips') && ++supplementaryCalls === 3) {
          throw new TypeError('socket hang up')
        }
        return respond(call)
      })
      const code = await main(['--record', '--task', 'tips', '--runs', '6'], {
        ...deps,
        modelFactory: factory,
      })

      expect(code).toBe(1)
      const md = readFileSync(join(outDir, '2026-10-01-check-production.md'), 'utf8')
      expect(md).toMatch(
        /\| tips \| Answered without error \| 91\.7% .*\| ≥ 100\.0% \| \*\*fail\*\* \|/,
      )
      expect(md).toMatch(/\| tips \| Item counts in range \| 91\.7% .*\| ≥ 90\.0% \| pass \|/)
      expect(existsSync(goldenDir)).toBe(false)
    })

    it('--record never writes a golden from a run --max-usd stopped, even with --force', async () => {
      const { factory } = mockModelFactory((call) => ({ ...respond(call), outputTokens: 200_000 }))
      const code = await main(['--record', '--force', '--task', 'tips', '--max-usd', '3'], {
        ...deps,
        modelFactory: factory,
      })

      expect(code).toBe(1)
      expect(existsSync(goldenDir)).toBe(false)
      expect(err.join('\n')).toContain('Golden not recorded: the run stopped early')
    })

    it('--record --dry-run names the files it would write and writes none', async () => {
      const code = await main(['--record', '--task', 'tips', '--dry-run'], deps)
      expect(code).toBe(0)
      expect(out.join('\n')).toMatch(/Would record: .*golden\/tips\.json/)
      expect(existsSync(goldenDir)).toBe(false)
    })

    it('--baseline golden calls only the candidate, states the golden and the prompt changes, and judges blind', async () => {
      await recordImagineAndTips()
      // One tips case's request "changed" since recording.
      editGolden('tips', (g) => {
        g.cases['tips/en-full-bolognese']!.requestHash = '0'.repeat(64)
      })

      const { factory, calls } = mockModelFactory(respond)
      const code = await main([...COMPARE, '--task', 'imagine,tips', '--runs', '1', '--judge'], {
        ...deps,
        modelFactory: factory,
      })

      expect(code).toBe(0)
      // 4 cases × 1 run, candidate only: no baseline call.
      expect(calls.map((c) => c.modelId)).toEqual(Array(4).fill('claude-sonnet-5'))

      let md = readFileSync(join(outDir, `${GOLDEN_STEM}.md`), 'utf8')
      expect(md).toContain('# Model benchmark: golden vs claude-sonnet-5')
      expect(md).toContain(
        `**Baseline:** golden — \`${IMAGINE_MODEL}\` recorded 2026-10-01 at \`abc1234\`, 2 run(s).`,
      )
      expect(md).toContain(
        '**Prompts since the golden:** imagine: unchanged; tips: prompt changed for 1 of 2 cases.',
      )
      expect(md).toContain('· 4 calls')
      expect(md).not.toContain('## Not in golden')
      // The golden's spend is not this run's.
      expect(md).toMatch(
        /\*\*Total cost:\*\* .*The golden's \$[\d.]+ was spent when it was recorded\./,
      )

      const json = JSON.parse(readFileSync(join(outDir, `${GOLDEN_STEM}.json`), 'utf8'))
      expect(json.plannedCalls).toBe(4)
      // The golden has 2 runs; only run 1, the one the candidate made, is replayed.
      expect(json.calls.filter((c: { role: string }) => c.role === 'baseline')).toHaveLength(4)
      expect(json.golden.map((g: { task: string }) => g.task)).toEqual(['imagine', 'tips'])

      // Nothing the judging session reads says which side is the golden.
      const pairs = JSON.parse(
        readFileSync(join(outDir, `${GOLDEN_STEM}.judge-pairs.json`), 'utf8'),
      )
      expect(pairs.items).toHaveLength(8)
      for (const secret of ['golden', 'baseline', 'candidate', 'claude-sonnet', 'abc1234']) {
        expect(JSON.stringify(pairs.items)).not.toContain(secret)
      }

      const verdicts = json.judgeKey.pairs.flatMap(
        (p: { items: { id: string; roleAsA: string }[] }) =>
          p.items.map((i) => ({
            id: i.id,
            winner: i.roleAsA === 'candidate' ? 'A' : 'B',
            reason: 'r',
          })),
      )
      const verdictsPath = join(outDir, pairs.verdictsFile)
      writeFileSync(verdictsPath, JSON.stringify({ judge: 'claude-code/opus', verdicts }))
      expect(await main(['--import-verdicts', verdictsPath], deps)).toBe(0)

      md = readFileSync(join(outDir, `${GOLDEN_STEM}.md`), 'utf8')
      expect(md).toContain('| imagine | 2 | 0 | 0 | 0 | 0 |')
      // The re-rendered report keeps the golden header.
      expect(md).toContain('**Prompts since the golden:** imagine: unchanged; tips: prompt changed')
      expect(md).toContain('· 4 calls')
    })

    it('reads a schema-only change as a prompt change, once the golden carries requestHash (HON-931)', async () => {
      await recordImagineAndTips()
      // Each comparison writes the next report: `<stem>.md`, `<stem>-2.md`, …
      const header = async (stem: string) => {
        const { factory } = mockModelFactory(respond)
        const code = await main([...COMPARE, '--task', 'tips', '--runs', '1'], {
          ...deps,
          modelFactory: factory,
        })
        expect(code).toBe(0)
        const md = readFileSync(join(outDir, `${stem}.md`), 'utf8')
        return md.split('\n').find((line) => line.startsWith('**Prompts since the golden:**'))
      }

      expect(await header(GOLDEN_STEM)).toBe('**Prompts since the golden:** tips: unchanged.')
      tipsSchemaEdit.on = true
      try {
        expect(await header(`${GOLDEN_STEM}-2`)).toBe(
          '**Prompts since the golden:** tips: prompt changed for 1 of 2 cases.',
        )
        // A golden recorded before requestHash existed compares prompt text
        // only, so it cannot see the edit (docs/AI_MODELS.md says so).
        editGolden('tips', (g) => {
          for (const entry of Object.values(g.cases)) delete entry.requestHash
        })
        expect(await header(`${GOLDEN_STEM}-3`)).toBe(
          '**Prompts since the golden:** tips: unchanged.',
        )
      } finally {
        tipsSchemaEdit.on = false
      }
    })

    it('lists a case missing from the golden under "Not in golden" and does not run it', async () => {
      await recordImagineAndTips()
      editGolden('tips', (g) => {
        delete g.cases['tips/et-supplementary-ahjulohe']
        // A golden case that no longer exists is ignored.
        g.cases['tips/retired-case'] = g.cases['tips/en-full-bolognese']!
      })

      const { factory, calls } = mockModelFactory(respond)
      const code = await main([...COMPARE, '--task', 'tips', '--runs', '1'], {
        ...deps,
        modelFactory: factory,
      })

      expect(code).toBe(0)
      expect(calls).toHaveLength(1)
      const md = readFileSync(join(outDir, `${GOLDEN_STEM}.md`), 'utf8')
      expect(md).toContain('## Not in golden')
      expect(md).toContain('- `tips/et-supplementary-ahjulohe` — re-record to include it')
      expect(md).toContain('**Prompts since the golden:** tips: unchanged.')
      expect(md).not.toContain('retired-case')
      // Echoed with the summary.
      expect(out.join('\n')).toContain('## Not in golden')
    })

    it('exits 1 naming a task that has no golden, even under --dry-run', async () => {
      await recordImagineAndTips()
      const code = await main([...COMPARE, '--task', 'tips,plan', '--dry-run'], deps)
      expect(code).toBe(1)
      expect(err.join('\n')).toMatch(
        /No golden for plan in .*\. Record one with `pnpm ai-eval --record --task plan`/,
      )
    })

    it('refuses a 1-run golden, against which every difference would read as noise', async () => {
      await recordImagineAndTips()
      editGolden('tips', (g) => {
        g.runs = 1
      })
      const code = await main([...COMPARE, '--task', 'tips', '--dry-run'], deps)
      expect(code).toBe(1)
      expect(err.join('\n')).toMatch(/The golden for tips has one run.*--record --task tips/)
    })

    it('exits 1 on a golden file that does not parse', async () => {
      await recordImagineAndTips()
      editGolden('tips', (g) => {
        delete g.commit
      })
      const code = await main([...COMPARE, '--task', 'tips', '--dry-run'], deps)
      expect(code).toBe(1)
      expect(err.join('\n')).toMatch(/Invalid golden .*tips\.json: commit/)
    })

    it('estimates the candidate alone under --dry-run, without pricing "golden"', async () => {
      await recordImagineAndTips()
      const code = await main([...COMPARE, '--task', 'imagine,tips', '--dry-run'], deps)

      expect(code).toBe(0)
      const text = out.join('\n')
      expect(text).toContain('Baseline: golden, read from file — no calls.')
      // 4 cases × the golden's 2 runs, one model.
      expect(text).toContain('runs: 2')
      expect(text).toContain('Total calls: 8')
      expect(text).toMatch(/ {2}claude-sonnet-5: 8 calls/)
    })

    it('replays only as many golden runs as the candidate makes', async () => {
      const { factory } = mockModelFactory(respond)
      expect(
        await main(['--record', '--task', 'tips', '--runs', '3'], {
          ...deps,
          modelFactory: factory,
        }),
      ).toBe(0)

      const code = await main([...COMPARE, '--task', 'tips', '--runs', '2'], {
        ...deps,
        modelFactory: factory,
      })
      expect(code).toBe(0)
      const json = JSON.parse(readFileSync(join(outDir, `${GOLDEN_STEM}.json`), 'utf8'))
      const runsBySide = (role: string) =>
        json.calls
          .filter((c: { role: string }) => c.role === role)
          .map((c: { run: number }) => c.run)
          .sort()
      // 2 tips cases × runs 1 and 2 on both sides; the golden's run 3 is left out.
      expect(runsBySide('baseline')).toEqual([1, 1, 2, 2])
      expect(runsBySide('candidate')).toEqual([1, 1, 2, 2])
    })

    it('refuses more candidate runs than the golden has, which the judge could never pair', async () => {
      await recordImagineAndTips()
      const code = await main(
        [...COMPARE, '--task', 'imagine,tips', '--runs', '3', '--dry-run'],
        deps,
      )
      expect(code).toBe(1)
      expect(err.join('\n')).toContain(
        '--runs 3 is more than the golden has for imagine (2), tips (2)',
      )
    })
  })

  describe('--import-sample', () => {
    const imagineSample = {
      type: 'ai_sample',
      timestamp: '2026-10-01T12:00:00.000Z',
      callSite: 'imagine-meal',
      locale: 'et',
      sampleRate: 1,
      input: {
        prompt: 'midagi kanaga',
        hasImages: false,
        dietaryType: null,
        allergens: [],
        excludedIngredients: [],
        restrictions: [],
        householdSize: 3,
      },
      output: { meals: [] },
    }

    function writeSample(body: unknown): string {
      const path = join(outDir, 'sample.log')
      writeFileSync(path, `[ai-sample] ${JSON.stringify(body)}\n`)
      return path
    }

    it('writes a draft into the cases directory, calls no model, and the run still skips it', async () => {
      const casesLine = async () => {
        out = []
        expect(await main([...BASE_ARGS, '--dry-run'], deps)).toBe(0)
        return out.find((line) => line.startsWith('Cases:'))
      }
      const before = await casesLine()
      expect(before).toMatch(/^Cases: \d+/)

      out = []
      const { factory, calls } = mockModelFactory(respond)
      const code = await main(
        ['--import-sample', writeSample(imagineSample), '--id', 'imagine/et-imported'],
        { ...deps, modelFactory: factory },
      )

      expect(code).toBe(0)
      expect(calls).toHaveLength(0)
      expect(err).toEqual([])
      const draftPath = join(casesDir, 'imagine', 'et-imported.draft.json')
      expect(JSON.parse(readFileSync(draftPath, 'utf8')).prompt).toBe('midagi kanaga')
      expect(out[0]).toMatch(/^Wrote .*imagine\/et-imported\.draft\.json\.$/)
      expect(out.join('\n')).toContain('rename the file to et-imported.json')

      // The draft is not a case: a dry run counts the same cases as before.
      expect(await casesLine()).toBe(before)
    })

    it('refuses fill-empty-slots with exit 1 and writes nothing', async () => {
      const path = writeSample({ ...imagineSample, callSite: 'fill-empty-slots' })
      const code = await main(['--import-sample', path, '--id', 'plan/x'], deps)
      expect(code).toBe(1)
      expect(err).toEqual(["fillEmptySlots is out of the benchmark's scope"])
      expect(existsSync(join(casesDir, 'plan', 'x.draft.json'))).toBe(false)
    })
  })

  describe('the bench:models alias (HON-904)', () => {
    const DEPRECATION = '`pnpm bench:models` is deprecated and will be removed: use `pnpm ai-eval`.'

    it('prints a deprecation line when invoked as bench:models, and still runs', async () => {
      const code = await main(['--check', '--dry-run'], {
        ...deps,
        env: { npm_lifecycle_event: 'bench:models' },
      })
      expect(code).toBe(0)
      expect(err).toEqual([DEPRECATION])
    })

    it('prints nothing extra when invoked as ai-eval', async () => {
      const code = await main(['--check', '--dry-run'], {
        ...deps,
        env: { npm_lifecycle_event: 'ai-eval' },
      })
      expect(code).toBe(0)
      expect(err).toEqual([])
    })

    it('names ai-eval in the usage text', async () => {
      expect(await main(['--baseline', 'claude-sonnet-5'], deps)).toBe(2)
      const usage = err.join('\n')
      expect(usage).toContain('Usage: pnpm ai-eval --baseline')
      expect(usage).not.toContain('bench:models')
    })
  })

  it.each([
    [['--record', '--baseline', 'claude-sonnet-5'], /--record runs one configuration.*--baseline/],
    [['--check', '--force'], /--force goes with --record/],
    [['--record', '--runs', '1'], /--record needs --runs 2 or more/],
    [['--baseline', 'claude-sonnet-5', '--candidate', 'golden'], /--candidate takes a model ID/],
    [['--check', '--baseline', 'claude-sonnet-5'], /--check runs one configuration.*--baseline/],
    [['--check', '--candidate', 'x', '--judge'], /cannot be combined with --candidate, --judge/],
    [['--check', '--judge-api'], /cannot be combined with --judge-api/],
    [[...BASE_ARGS, '--model', 'claude-sonnet-5'], /--model goes with --check/],
    [['--baseline', 'claude-sonnet-5'], /--candidate are both required/],
    [[...BASE_ARGS, '--task', 'plan,dessert'], /Unknown --task dessert/],
    [[...BASE_ARGS, '--runs', '0'], /--runs must be a positive integer/],
    [[...BASE_ARGS, '--max-usd', 'lots'], /--max-usd must be a positive number/],
    [[...BASE_ARGS, '--verbose'], /Unknown option '--verbose'/],
    [[...BASE_ARGS, '--judge', '--judge-api'], /--judge and --judge-api are alternatives/],
    [['--import-verdicts', 'results/run.json'], /takes a `\*\.judge-verdicts\.json` file/],
    [['--import-verdicts', 'nowhere/x.judge-verdicts.json'], /No verdicts file at/],
    [['--id', 'imagine/x'], /--id goes with --import-sample/],
    [['--import-sample', 's.json'], /--import-sample needs --id <task>\/<slug>/],
    [
      ['--import-sample', 's.json', '--id', 'imagine/x', '--check', '--dry-run'],
      /--import-sample writes a draft case and runs nothing; it cannot be combined with (?=.*--check)(?=.*--dry-run)/,
    ],
    [
      [
        '--import-sample',
        's.json',
        '--id',
        'imagine/x',
        '--import-verdicts',
        'a.judge-verdicts.json',
      ],
      /cannot be combined with --import-verdicts/,
    ],
  ])('rejects bad arguments: %j', async (argv, message) => {
    const code = await main(argv, deps)
    expect(code).toBe(2)
    expect(err.join('\n')).toMatch(message)
  })
})
