import { describe, expect, it } from 'vitest'
import { isIndexable, noindexHeaders } from './indexing'

const NON_PRODUCTION = ['dev', 'preview', 'staging', 'ci', 'test', undefined, '', 'Production']

describe('isIndexable', () => {
  it('is true for production only', () => {
    expect(isIndexable('production')).toBe(true)
  })

  it.each(NON_PRODUCTION)('is false for %j', (appEnv) => {
    expect(isIndexable(appEnv)).toBe(false)
  })
})

describe('noindexHeaders', () => {
  it('adds no header in production', () => {
    expect(noindexHeaders('production')).toEqual([])
  })

  it.each(NON_PRODUCTION)('adds X-Robots-Tag: noindex, nofollow for %j', (appEnv) => {
    expect(noindexHeaders(appEnv)).toEqual([{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }])
  })
})
