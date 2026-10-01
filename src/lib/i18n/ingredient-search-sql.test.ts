import { describe, it, expect } from 'vitest'
import { Prisma } from '@/generated/prisma/client'
import { ingredientNameMatchSql } from './ingredient-search-sql'

/** Render a fragment as SQL text with `?` placeholders, plus its values. */
function render(fragment: Prisma.Sql) {
  return { sql: fragment.strings.join('?'), values: fragment.values }
}

describe('ingredientNameMatchSql', () => {
  it('matches the English name alone for the default locale, with no join', () => {
    const match = ingredientNameMatchSql('potato', 'en')

    expect(match.join).toBe(Prisma.empty)
    expect(render(match.displayName).sql).toBe('i.name')
    expect(render(match.score)).toEqual({ sql: 'similarity(i.name, ?)', values: ['potato'] })
  })

  it('treats a missing locale as the default', () => {
    expect(ingredientNameMatchSql('potato', null).join).toBe(Prisma.empty)
  })

  it("joins the locale's translation and scores the better of the two names", () => {
    const match = ingredientNameMatchSql('kartul', 'et')

    expect(render(match.join)).toEqual({
      sql: 'LEFT JOIN "ingredient_translation" t ON t."ingredientId" = i.id AND t.locale = ?',
      values: ['et'],
    })
    expect(render(match.displayName).sql).toBe('COALESCE(t.name, i.name)')
    expect(render(match.score)).toEqual({
      sql: 'GREATEST(similarity(i.name, ?), COALESCE(similarity(t.name, ?), 0))',
      values: ['kartul', 'kartul'],
    })
  })
})
