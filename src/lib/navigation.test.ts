import { describe, it, expect } from 'vitest'
import { isNavItemActive } from './navigation'

describe('isNavItemActive', () => {
  it('matches Today only on the root path', () => {
    expect(isNavItemActive('/', '/')).toBe(true)
    expect(isNavItemActive('/', '/shopping')).toBe(false)
    expect(isNavItemActive('/', '/recipes/imagine')).toBe(false)
  })

  it('matches a destination on its own path', () => {
    expect(isNavItemActive('/shopping', '/shopping')).toBe(true)
    expect(isNavItemActive('/recipes', '/shopping')).toBe(false)
  })

  it('matches a destination on its sub-routes', () => {
    expect(isNavItemActive('/recipes', '/recipes/imagine')).toBe(true)
    expect(isNavItemActive('/shopping', '/recipes/imagine')).toBe(false)
  })

  it('does not match a path that only shares a prefix', () => {
    expect(isNavItemActive('/recipes', '/recipes-old')).toBe(false)
  })

  it('matches nothing when the pathname is unknown', () => {
    expect(isNavItemActive('/', null)).toBe(false)
    expect(isNavItemActive('/shopping', null)).toBe(false)
  })
})
