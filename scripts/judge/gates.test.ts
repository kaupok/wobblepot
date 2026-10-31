import { describe, expect, it } from 'vitest'

import { extractPaths, globToRegExp, loadGates, matchGate, parseGates } from './gates'

const gates = loadGates()

describe('loadGates', () => {
  it('reads the seven gates from gates.md', () => {
    expect(gates.map((g) => g.name)).toEqual([
      'gtm',
      'legal',
      'money',
      'ai-spend',
      'irreversible',
      'auth',
      'allergens',
    ])
  })

  it('rejects a file with no json block', () => {
    expect(() => parseGates('# Gates\n\nno block')).toThrow('exactly one json block')
  })
})

describe('extractPaths', () => {
  it('strips line suffixes, wrapping parentheses and trailing punctuation', () => {
    expect(
      extractPaths(
        'See `src/lib/x.ts:42`, (prisma/schema.prisma) and src/app/(legal)/privacy/page.tsx.',
      ),
    ).toEqual(['src/lib/x.ts', 'prisma/schema.prisma', 'src/app/(legal)/privacy/page.tsx'])
  })
})

describe('globToRegExp', () => {
  it('lets ** cross segments and * stay inside one', () => {
    expect(
      globToRegExp('prisma/migrations/**').test('prisma/migrations/2026_x/migration.sql'),
    ).toBe(true)
    expect(globToRegExp('src/lib/auth*').test('src/lib/auth-client.ts')).toBe(true)
    expect(globToRegExp('src/lib/auth*').test('src/lib/auth/session.ts')).toBe(false)
    expect(globToRegExp('src/app/(legal)/**').test('src/app/(legal)/terms/page.tsx')).toBe(true)
  })
})

describe('matchGate', () => {
  it('holds an issue that touches prisma/migrations as irreversible', () => {
    expect(
      matchGate(
        {
          title: '[AUTO DRAFT] Meal plan rows keep a stale column default',
          description:
            '## Problem\n\n`prisma/migrations/20261020_meal_plan/migration.sql:12` sets the default.',
        },
        gates,
      ),
    ).toEqual({
      gate: 'irreversible',
      kind: 'path',
      matched: 'prisma/migrations/20261020_meal_plan/migration.sql',
    })
  })

  it('holds an auth client path, a GTM label and a pricing keyword', () => {
    expect(matchGate({ title: 'x', description: 'In src/lib/auth-client.ts:9' }, gates)?.gate).toBe(
      'auth',
    )
    expect(matchGate({ title: 'x', labels: ['gtm'] }, gates)).toEqual({
      gate: 'gtm',
      kind: 'label',
      matched: 'GTM',
    })
    expect(matchGate({ title: 'The price shows twice' }, gates)?.gate).toBe('gtm')
  })

  it('matches a plural keyword and ignores keywords inside paths and words', () => {
    expect(matchGate({ title: 'Hide allergens in the cook view' }, gates)?.gate).toBe('allergens')
    expect(matchGate({ title: 'Fix src/lib/channels.ts at the supermarket' }, gates)).toBeNull()
  })

  it('holds a gated directory and a markdown-linked path', () => {
    expect(
      matchGate({ title: 'x', description: 'Files in `prisma/migrations/` change.' }, gates),
    ).toEqual({ gate: 'irreversible', kind: 'path', matched: 'prisma/migrations' })
    expect(matchGate({ title: 'See src/app/(legal) pages' }, gates)?.gate).toBe('legal')
    expect(
      matchGate({ title: 'x', description: 'See [src/proxy.ts](https://x.dev/a)' }, gates),
    ).toEqual({ gate: 'auth', kind: 'path', matched: 'src/proxy.ts' })
  })

  it('passes a plain UI finding', () => {
    expect(
      matchGate(
        {
          title: '[AUTO DRAFT] Fridge meal: Undo after Clear fails on a lunch',
          description: '`src/components/meal-plan/FridgeMeal.tsx:88` drops the second dinner.',
          labels: ['Bug'],
        },
        gates,
      ),
    ).toBeNull()
  })
})
