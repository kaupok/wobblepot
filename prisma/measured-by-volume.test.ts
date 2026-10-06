import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  isMeasuredByVolume,
  MEASURED_BY_VOLUME_NAMES,
  MEASURED_BY_VOLUME_SUBCATEGORIES,
  NOT_MEASURED_BY_VOLUME_NAMES,
} from './measured-by-volume'

describe('isMeasuredByVolume', () => {
  it.each([
    ['red wine', 'cooking wine'],
    ['beef stock', 'liquid'],
    ['olive oil', 'oil'],
    ['truffle oil', 'oil'],
    ['milk', 'liquid'],
  ])('is true for %j in a pourable subcategory (%s)', (name, subcategory) => {
    expect(isMeasuredByVolume({ name, subcategory })).toBe(true)
  })

  it.each([
    ['heavy cream', 'cream'],
    ['soy sauce', 'sauce'],
  ])('is true for the named liquid %j in a mixed subcategory (%s)', (name, subcategory) => {
    expect(isMeasuredByVolume({ name, subcategory })).toBe(true)
  })

  it.each([
    ['coconut oil', 'oil'],
    ['palm oil', 'oil'],
    ['condensed milk', 'milk'],
    ['guarana', 'extract'],
  ])(
    'is false for the excluded name %j even in a pourable subcategory (%s)',
    (name, subcategory) => {
      expect(isMeasuredByVolume({ name, subcategory })).toBe(false)
    },
  )

  it.each([
    ['creme fraiche', 'cream'],
    ['clotted cream', 'cream'],
    ['pesto', 'sauce'],
    ['mayonnaise', 'sauce'],
    ['bbq sauce', 'sauce'],
    ['anchovy paste', 'paste'],
  ])('is false for %j in a subcategory outside the rule (%s)', (name, subcategory) => {
    expect(isMeasuredByVolume({ name, subcategory })).toBe(false)
  })

  it('is false with no subcategory unless the name is listed', () => {
    expect(isMeasuredByVolume({ name: 'mystery liquid', subcategory: null })).toBe(false)
    expect(isMeasuredByVolume({ name: 'mystery liquid' })).toBe(false)
    expect(isMeasuredByVolume({ name: 'tamari', subcategory: null })).toBe(true)
  })

  it('matches names and subcategories case-sensitively', () => {
    expect(isMeasuredByVolume({ name: 'Soy Sauce', subcategory: 'sauce' })).toBe(false)
    expect(isMeasuredByVolume({ name: 'water', subcategory: 'Liquid' })).toBe(false)
  })
})

describe('migration 20261006130000_add_ingredient_measured_by_volume', () => {
  const sql = readFileSync(
    path.join(
      __dirname,
      'migrations/20261006130000_add_ingredient_measured_by_volume/migration.sql',
    ),
    'utf8',
  )

  // The migration repeats the module's lists by hand. Each list is the quoted
  // values of one `<column> [NOT] IN (...)` clause.
  function sqlList(clause: string): string[] {
    const start = sql.indexOf(clause)
    expect(start, `migration has no ${clause} clause`).toBeGreaterThanOrEqual(0)
    const body = sql.slice(start + clause.length, sql.indexOf(')', start))
    return [...body.matchAll(/'([^']*)'/g)].map((m) => m[1] ?? '')
  }

  it('lists exactly the module subcategories', () => {
    expect(sqlList('"subcategory" IN (').sort()).toEqual(
      [...MEASURED_BY_VOLUME_SUBCATEGORIES].sort(),
    )
  })

  it('lists exactly the module include names', () => {
    expect(sqlList('"name" IN (').sort()).toEqual([...MEASURED_BY_VOLUME_NAMES].sort())
  })

  it('lists exactly the module exclude names', () => {
    expect(sqlList('"name" NOT IN (').sort()).toEqual([...NOT_MEASURED_BY_VOLUME_NAMES].sort())
  })

  it('touches global ingredients only', () => {
    expect(sql).toContain('WHERE "householdId" IS NULL')
  })
})
