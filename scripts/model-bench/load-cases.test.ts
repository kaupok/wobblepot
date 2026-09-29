// @vitest-environment node
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { TASKS } from './case-schema'
import { loadCases } from './load-cases'
import { prepareCase } from './tasks'

describe('the committed starter cases', () => {
  const cases = loadCases(TASKS)

  it.each(TASKS)('%s has one English and one Estonian case', (task) => {
    const locales = cases.filter((c) => c.task === task).map((c) => c.input.locale)
    expect(locales.sort()).toEqual(['en', 'et'])
  })

  it('tips has one full and one supplementary case', () => {
    const kinds = cases.flatMap((c) => (c.task === 'tips' ? [c.input.kind] : []))
    expect(kinds.sort()).toEqual(['full', 'supplementary'])
  })

  it('ids come from the directory and file name', () => {
    expect(cases.map((c) => c.id)).toContain('recipe/en-carbonara')
  })

  it('every case builds a request production would send', () => {
    // Plan cases fail here if a required protein pool is empty.
    for (const c of cases) {
      expect(prepareCase(c).promptText.length, c.id).toBeGreaterThan(100)
    }
  })

  it('plan slots come from the slot rules, not the case', () => {
    const plan = cases.find((c) => c.id === 'plan/et-vegetarian-weekend-lunch')!
    const text = prepareCase(plan).promptText
    // 5 weekday dinners + 2 weekend lunches + 2 weekend dinners.
    expect(text).toContain('Return exactly 9 entries')
  })
})

describe('loadCases', () => {
  let dir: string
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  function write(task: string, file: string, body: string) {
    mkdirSync(join(dir, task), { recursive: true })
    writeFileSync(join(dir, task, file), body)
  }

  it('fails on an invalid case, naming the file', () => {
    dir = mkdtempSync(join(tmpdir(), 'model-bench-'))
    write('imagine', 'broken.json', JSON.stringify({ prompt: 'x', locale: 'en' }))
    expect(() => loadCases(['imagine'], dir)).toThrow(/imagine\/broken\.json.*household/)
  })

  it('fails on a file that is not JSON, naming the file', () => {
    dir = mkdtempSync(join(tmpdir(), 'model-bench-'))
    write('tips', 'oops.json', '{ not json')
    expect(() => loadCases(['tips'], dir)).toThrow(/tips\/oops\.json.*not valid JSON/)
  })

  it('rejects a review expectation for an ingredient the case does not have', () => {
    dir = mkdtempSync(join(tmpdir(), 'model-bench-'))
    write(
      'review',
      'typo.json',
      JSON.stringify({
        mealName: 'Soup',
        servings: 2,
        ingredients: [{ ingredientId: 'a', name: 'carrot', quantityPerServing: 80, unit: 'g' }],
        locale: 'en',
        expected: { b: { unchanged: true } },
      }),
    )
    expect(() => loadCases(['review'], dir)).toThrow(/review\/typo\.json.*expected\.b/)
  })

  it('rejects a date that is not YYYY-MM-DD', () => {
    dir = mkdtempSync(join(tmpdir(), 'model-bench-'))
    write(
      'plan',
      'date.json',
      JSON.stringify({
        startDate: '5.10.2026',
        endDate: '2026-10-12',
        weekdayMealTypes: ['dinner'],
        weekendMealTypes: ['dinner'],
        dietaryType: null,
        restrictions: [],
        pantryIngredients: [],
        locale: 'en',
        candidatePools: { fish: [], legume: [], any: [] },
        candidatesByMealType: {},
      }),
    )
    expect(() => loadCases(['plan'], dir)).toThrow(/plan\/date\.json.*startDate/)
  })

  it('fails when a task has no case directory', () => {
    dir = mkdtempSync(join(tmpdir(), 'model-bench-'))
    expect(() => loadCases(['recipe'], dir)).toThrow(/No case directory for task "recipe"/)
  })
})
