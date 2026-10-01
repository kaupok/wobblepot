// @vitest-environment node
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CASE_SCHEMAS, TASKS } from './case-schema'
import {
  describeDraft,
  draftFromSample,
  importSample,
  ImportSampleError,
  OUT_OF_SCOPE_MESSAGE,
  parseCaseId,
  parseSampleText,
  type AiSample,
} from './import-sample'
import { loadCases } from './load-cases'

/**
 * One sample per call site, shaped as each passes `input` to `logAiSample`:
 * `generate-plan.ts`, `imagine-meal.ts`, `parse-recipe.ts`,
 * `review-quantities.ts` and the preparation-tips route.
 */
const SAMPLES = {
  'generate-plan': {
    type: 'ai_sample',
    timestamp: '2026-10-01T12:00:00.000Z',
    callSite: 'generate-plan',
    locale: 'et',
    sampleRate: 1,
    input: {
      mealTypes: ['dinner', 'lunch'],
      totalEntries: 9,
      restrictionsCount: 2,
      hasPantry: true,
      candidatePoolSizes: { fish: 4, legume: 6, any: 30 },
    },
    output: { entries: [{ date: '2026-10-05', mealType: 'dinner', mealId: 'm1' }] },
  },
  'imagine-meal': {
    type: 'ai_sample',
    timestamp: '2026-10-01T12:00:00.000Z',
    callSite: 'imagine-meal',
    locale: 'en',
    sampleRate: 0.05,
    input: {
      prompt: 'something warm with lentils',
      hasImages: false,
      dietaryType: 'vegetarian',
      allergens: ['nuts'],
      excludedIngredients: ['coriander'],
      restrictions: ['mild for the kids'],
      householdSize: 4,
    },
    output: { meals: [{ name: 'Lentil soup' }] },
  },
  'parse-recipe': {
    type: 'ai_sample',
    timestamp: '2026-10-01T12:00:00.000Z',
    callSite: 'parse-recipe',
    locale: 'et',
    sampleRate: 1,
    input: { textPreview: 'Pannkoogid\n3 muna\n500 ml piima', textLength: 1800 },
    output: { name: 'Pannkoogid', ingredients: [] },
  },
  'review-quantities': {
    type: 'ai_sample',
    timestamp: '2026-10-01T12:00:00.000Z',
    callSite: 'review-quantities',
    locale: 'et',
    sampleRate: 1,
    input: {
      mealName: 'Hakklihakaste',
      servings: 4,
      ingredients: [
        { name: 'Hakkliha', quantityPerServing: 5, unit: 'g' },
        { name: 'Küüslauk', quantityPerServing: 1, unit: 'piece' },
        { name: 'küüslauk', quantityPerServing: 3, unit: 'g' },
      ],
    },
    output: { ingredients: [{ ingredientId: 'cm1abc', quantityPerServing: 125 }] },
  },
  'preparation-tips-full': {
    type: 'ai_sample',
    timestamp: '2026-10-01T12:00:00.000Z',
    callSite: 'preparation-tips-full',
    locale: 'en',
    sampleRate: 0.05,
    input: {
      mealName: 'Shakshuka',
      householdSize: 3,
      timeMinutes: 30,
      ingredientsCount: 6,
      hasUserNotes: false,
    },
    output: { equipment: [], steps: [], pitfalls: [] },
  },
  'preparation-tips-supplementary': {
    type: 'ai_sample',
    timestamp: '2026-10-01T12:00:00.000Z',
    callSite: 'preparation-tips-supplementary',
    locale: 'et',
    sampleRate: 1,
    input: {
      mealName: 'Ahjulõhe',
      householdSize: 2,
      timeMinutes: null,
      ingredientsCount: 4,
      hasUserNotes: true,
    },
    output: { pitfalls: ['p'], tip: 't' },
  },
} as const

const sample = (callSite: keyof typeof SAMPLES) => SAMPLES[callSite] as unknown as AiSample

describe('parseSampleText', () => {
  const object = SAMPLES['imagine-meal']

  it('reads a bare JSON object, pretty-printed or not', () => {
    expect(parseSampleText(JSON.stringify(object, null, 2)).callSite).toBe('imagine-meal')
    expect(parseSampleText(`${JSON.stringify(object)}\n`).callSite).toBe('imagine-meal')
  })

  it('reads the stdout line with its prefix, and a log line with text before the prefix', () => {
    expect(parseSampleText(`[ai-sample] ${JSON.stringify(object)}`).callSite).toBe('imagine-meal')
    expect(
      parseSampleText(`2026-10-01T12:00:00Z info [ai-sample] ${JSON.stringify(object)}`).input,
    ).toEqual(object.input)
  })

  it('refuses a file of several samples', () => {
    const two = `${JSON.stringify(object)}\n${JSON.stringify(object)}\n`
    expect(() => parseSampleText(two)).toThrow(/holds 2 lines and is not one JSON object/)
    expect(() => parseSampleText(`[ai-sample] ${two}`)).toThrow(/holds 2 lines/)
  })

  it('refuses an empty file, invalid JSON, and JSON that is not a sample', () => {
    expect(() => parseSampleText('  \n')).toThrow(/empty/)
    expect(() => parseSampleText('{nope')).toThrow(/not valid JSON/)
    expect(() => parseSampleText('{"callSite":"imagine-meal"}')).toThrow(
      /Not an \[ai-sample\] record: type/,
    )
  })
})

describe('parseCaseId', () => {
  it('splits <task>/<slug>', () => {
    expect(parseCaseId('imagine/en-pasta-for-two')).toEqual({
      task: 'imagine',
      slug: 'en-pasta-for-two',
    })
  })

  it.each(['imagine', 'meals/en-x', 'imagine/En-x', 'imagine/en_x', 'imagine/en-x.json'])(
    'refuses "%s"',
    (id) => {
      expect(() => parseCaseId(id)).toThrow(ImportSampleError)
    },
  )
})

describe('draftFromSample', () => {
  it('refuses fill-empty-slots with the scope message', () => {
    const fill = { ...sample('imagine-meal'), callSite: 'fill-empty-slots' }
    expect(() => draftFromSample(fill)).toThrow(OUT_OF_SCOPE_MESSAGE)
    expect(OUT_OF_SCOPE_MESSAGE).toBe("fillEmptySlots is out of the benchmark's scope")
  })

  it('refuses an unknown call site', () => {
    expect(() => draftFromSample({ ...sample('imagine-meal'), callSite: 'swap-meal' })).toThrow(
      /Unknown callSite "swap-meal"/,
    )
  })

  it('names the field when a call site logs a shape it does not read', () => {
    const drifted = { ...sample('imagine-meal'), input: { prompt: 'x' } }
    expect(() => draftFromSample(drifted)).toThrow(/imagine-meal sample's input.*allergens/)
  })

  it('keeps the sample for reference, and marks the draft as imported', () => {
    const { draft } = draftFromSample(sample('imagine-meal'))
    expect(draft.source).toBe('ai-sample')
    expect(draft.sampleInput).toEqual(SAMPLES['imagine-meal'].input)
    expect(draft.sampleOutput).toEqual(SAMPLES['imagine-meal'].output)
  })

  it('reads a missing locale as the default', () => {
    const { draft } = draftFromSample({ ...sample('imagine-meal'), locale: null })
    expect(draft.locale).toBe('en')
  })

  it('maps imagine field by field, with empty expectations', () => {
    const { task, draft, missingInput, expectations } = draftFromSample(sample('imagine-meal'))
    expect(task).toBe('imagine')
    expect(draft).toMatchObject({
      prompt: 'something warm with lentils',
      household: {
        allergens: ['nuts'],
        dietaryType: 'vegetarian',
        excludedIngredients: ['coriander'],
        restrictions: ['mild for the kids'],
        householdSize: 4,
      },
      locale: 'en',
      forbiddenKeywords: [],
      allowedQualifiers: [],
    })
    expect(missingInput).toEqual([])
    expect(expectations.join('\n')).toMatch(/forbiddenKeywords.*\n.*allowedQualifiers/)
  })

  it('says when an imagine sample came with images', () => {
    const withImages = {
      ...sample('imagine-meal'),
      input: { ...SAMPLES['imagine-meal'].input, hasImages: true },
    }
    expect(draftFromSample(withImages).notes.join(' ')).toMatch(/images/)
  })

  it('maps a recipe sample to its preview text, and says it was truncated', () => {
    const { task, draft, missingInput } = draftFromSample(sample('parse-recipe'))
    expect(task).toBe('recipe')
    expect(draft).toMatchObject({
      text: 'Pannkoogid\n3 muna\n500 ml piima',
      locale: 'et',
      expected: { ingredients: [], lowConfidence: null, stepCount: null },
    })
    expect(missingInput).toEqual([expect.stringMatching(/first 30 of 1800 characters/)])
  })

  it('gives review ingredients unique IDs made from their names', () => {
    const { task, draft } = draftFromSample(sample('review-quantities'))
    expect(task).toBe('review')
    expect(draft).toMatchObject({
      mealName: 'Hakklihakaste',
      servings: 4,
      locale: 'et',
      expected: {},
      ingredients: [
        { ingredientId: 'ing-hakkliha', name: 'Hakkliha', quantityPerServing: 5, unit: 'g' },
        { ingredientId: 'ing-kuuslauk', name: 'Küüslauk', quantityPerServing: 1, unit: 'piece' },
        { ingredientId: 'ing-kuuslauk-2', name: 'küüslauk', quantityPerServing: 3, unit: 'g' },
      ],
    })
  })

  it.each([
    ['preparation-tips-full', 'full'],
    ['preparation-tips-supplementary', 'supplementary'],
  ] as const)('maps %s to a %s tips case', (callSite, kind) => {
    const { task, draft, missingInput } = draftFromSample(sample(callSite))
    expect(task).toBe('tips')
    expect(draft.kind).toBe(kind)
    expect(draft.servings).toBe(SAMPLES[callSite].input.householdSize)
    expect(draft.timeMinutes).toBe(SAMPLES[callSite].input.timeMinutes)
    expect(draft.components).toEqual([])
    expect(missingInput[0]).toMatch(/components: .* had \d ingredients/)
    if (kind === 'supplementary') {
      expect(draft.preparationNotes).toBe('')
      expect(missingInput[1]).toMatch(/preparationNotes/)
    } else {
      expect(draft).not.toHaveProperty('preparationNotes')
    }
  })

  it('maps only the locale of a plan sample, and lists everything else it lacks', () => {
    const { task, draft, missingInput, expectations } = draftFromSample(sample('generate-plan'))
    expect(task).toBe('plan')
    expect(draft).toMatchObject({
      startDate: '',
      endDate: '',
      weekdayMealTypes: [],
      weekendMealTypes: [],
      dietaryType: null,
      restrictions: [],
      pantryIngredients: [],
      locale: 'et',
      candidatePools: { fish: [], legume: [], any: [] },
      candidatesByMealType: {},
    })
    const text = missingInput.join('\n')
    expect(text).toMatch(/startDate, endDate: .*9 slots/)
    expect(text).toMatch(/meal types \(dinner, lunch\)/)
    expect(text).toMatch(/restrictions: .*there were 2/)
    expect(text).toMatch(/pantryIngredients/)
    expect(text).toMatch(/fish 4, legume 6, any 30/)
    expect(expectations).toEqual([])
  })

  it('omits restrictions and pantry from a plan sample that had none', () => {
    const plain = {
      ...sample('generate-plan'),
      input: { ...SAMPLES['generate-plan'].input, restrictionsCount: 0, hasPantry: false },
    }
    const text = draftFromSample(plain).missingInput.join('\n')
    expect(text).not.toMatch(/restrictions|pantryIngredients/)
  })

  it('makes a draft that validates once its expectation is written and the sample keys go', () => {
    const imagine = draftFromSample(sample('imagine-meal')).draft
    const { sampleInput: _i, sampleOutput: _o, ...finished } = imagine
    expect(CASE_SCHEMAS.imagine.safeParse(finished).success).toBe(true)

    const review = draftFromSample(sample('review-quantities')).draft
    const { sampleInput: _ri, sampleOutput: _ro, ...reviewCase } = review
    const written = { ...reviewCase, expected: { 'ing-hakkliha': { min: 100, max: 150 } } }
    expect(CASE_SCHEMAS.review.safeParse(written).success).toBe(true)
  })

  it('makes a draft that does not validate while the sample keys are still in it', () => {
    const { draft } = draftFromSample(sample('imagine-meal'))
    const result = CASE_SCHEMAS.imagine.safeParse(draft)
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.code).toBe('unrecognized_keys')
  })
})

describe('importSample', () => {
  let dir: string
  let casesDir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'import-sample-'))
    casesDir = join(dir, 'cases')
    for (const task of TASKS) mkdirSync(join(casesDir, task), { recursive: true })
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  function sampleFile(body: unknown, name = 'sample.json'): string {
    const path = join(dir, name)
    writeFileSync(path, typeof body === 'string' ? body : JSON.stringify(body))
    return path
  }

  it.each(Object.keys(SAMPLES) as (keyof typeof SAMPLES)[])(
    'writes a %s draft that loadCases skips',
    (callSite) => {
      const task = draftFromSample(sample(callSite)).task
      const result = importSample({
        samplePath: sampleFile(SAMPLES[callSite]),
        id: `${task}/x-imported`,
        casesDir,
      })

      expect(result.path).toBe(join(casesDir, task, 'x-imported.draft.json'))
      const written = JSON.parse(readFileSync(result.path, 'utf8'))
      expect(written).toEqual(result.draft)
      expect(written.sampleOutput).toEqual(SAMPLES[callSite].output)
      expect(loadCases([task], casesDir)).toEqual([])
    },
  )

  it('refuses fill-empty-slots and writes nothing', () => {
    const path = sampleFile({ ...SAMPLES['imagine-meal'], callSite: 'fill-empty-slots' })
    expect(() => importSample({ samplePath: path, id: 'plan/x', casesDir })).toThrow(
      OUT_OF_SCOPE_MESSAGE,
    )
    expect(loadCases(['plan'], casesDir)).toEqual([])
  })

  it("refuses an --id whose task is not the sample's", () => {
    const path = sampleFile(SAMPLES['imagine-meal'])
    expect(() => importSample({ samplePath: path, id: 'recipe/x', casesDir })).toThrow(
      'The sample is from imagine-meal, which the benchmark runs as the imagine task; --id says recipe.',
    )
  })

  it.each(['x.json', 'x.draft.json'])('refuses to overwrite %s', (existing) => {
    writeFileSync(join(casesDir, 'imagine', existing), '{}')
    const path = sampleFile(SAMPLES['imagine-meal'])
    expect(() => importSample({ samplePath: path, id: 'imagine/x', casesDir })).toThrow(
      `imagine/${existing} already exists`,
    )
  })

  it('refuses a missing sample file', () => {
    expect(() =>
      importSample({ samplePath: join(dir, 'nope.json'), id: 'imagine/x', casesDir }),
    ).toThrow(/No sample file at/)
  })

  it('describes what is left to fill in, and how to finish', () => {
    const result = importSample({
      samplePath: sampleFile(SAMPLES['generate-plan']),
      id: 'plan/et-imported',
      casesDir,
    })
    const text = describeDraft(result, 'cases/plan/et-imported.draft.json').join('\n')
    expect(text).toContain('Wrote cases/plan/et-imported.draft.json.')
    expect(text).toMatch(/Not in the sample, so left empty\. Fill in by hand:\n {2}- startDate/)
    expect(text).toMatch(
      /delete sampleInput and sampleOutput, and rename the file to et-imported\.json/,
    )
    expect(text).not.toContain('Write the expectation')
    expect(text).toMatch(/delete the sample file now, and finish or delete the draft today/)
  })
})
