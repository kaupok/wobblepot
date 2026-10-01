// @vitest-environment node
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { TASKS } from './case-schema'
import { loadCases } from './load-cases'
import { prepareCase } from './tasks'

describe('the committed cases', () => {
  const cases = loadCases(TASKS)

  // HON-797: enough cases per task that one failure does not move a rate past
  // a regression threshold on its own.
  it.each(TASKS)('%s has 8 to 10 cases, at least 3 of them Estonian', (task) => {
    const locales = cases.filter((c) => c.task === task).map((c) => c.input.locale)
    expect(locales.length).toBeGreaterThanOrEqual(8)
    expect(locales.length).toBeLessThanOrEqual(10)
    expect(locales.filter((l) => l === 'et').length).toBeGreaterThanOrEqual(3)
  })

  it('tips has at least 3 cases of each kind', () => {
    const kinds = cases.flatMap((c) => (c.task === 'tips' ? [c.input.kind] : []))
    expect(kinds.filter((k) => k === 'full').length).toBeGreaterThanOrEqual(3)
    expect(kinds.filter((k) => k === 'supplementary').length).toBeGreaterThanOrEqual(3)
  })

  it('every plan case offers 20 to 50 dinner candidates, with meal IDs unique in the case', () => {
    for (const c of cases) {
      if (c.task !== 'plan') continue
      const { fish, legume, any } = c.input.candidatePools
      const dinner = [...fish, ...legume, ...any]
      expect(dinner.length, c.id).toBeGreaterThanOrEqual(20)
      expect(dinner.length, c.id).toBeLessThanOrEqual(50)

      // The same meal may appear under several meal types, so compare by ID
      // only across different meals: one ID must never name two meals.
      const names = new Map<string, string>()
      for (const meal of [...dinner, ...Object.values(c.input.candidatesByMealType).flat()]) {
        expect(names.get(meal.id) ?? meal.name, `${c.id}: ${meal.id}`).toBe(meal.name)
        names.set(meal.id, meal.name)
      }
      expect(new Set(dinner.map((m) => m.id)).size, c.id).toBe(dinner.length)
    }
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

  it('skips a .draft.json, even one that would not validate', () => {
    dir = mkdtempSync(join(tmpdir(), 'model-bench-'))
    write('imagine', 'en-imported.draft.json', JSON.stringify({ prompt: '', sampleOutput: {} }))
    expect(loadCases(['imagine'], dir)).toEqual([])
  })

  it('fails when a task has no case directory', () => {
    dir = mkdtempSync(join(tmpdir(), 'model-bench-'))
    expect(() => loadCases(['recipe'], dir)).toThrow(/No case directory for task "recipe"/)
  })
})
