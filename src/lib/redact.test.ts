import { describe, expect, it } from 'vitest'
import { redactFreeText, sanitizeEventProperties } from './redact'

describe('redactFreeText', () => {
  it('truncates at 20 chars and appends a hash suffix', () => {
    const out = redactFreeText('this is a long sentence with a name in it')
    expect(out.startsWith('this is a long sente…[h:')).toBe(true)
    expect(out).toMatch(/\[h:[0-9a-f]{8}\]$/)
  })

  it('produces a deterministic hash for the same input', () => {
    expect(redactFreeText('hello world')).toBe(redactFreeText('hello world'))
  })

  it('produces different hashes for different inputs', () => {
    const a = redactFreeText('one input string')
    const b = redactFreeText('a different string here')
    expect(a).not.toBe(b)
  })

  it('returns empty string unchanged', () => {
    expect(redactFreeText('')).toBe('')
  })

  it('handles short strings (no truncation visible, hash still present)', () => {
    const out = redactFreeText('short')
    expect(out).toMatch(/^short…\[h:[0-9a-f]{8}\]$/)
  })

  it('handles unicode without crashing', () => {
    const out = redactFreeText('Tere, kuidas läheb? Eestlane räägib eesti keelt')
    expect(out).toMatch(/\[h:[0-9a-f]{8}\]$/)
  })
})

describe('sanitizeEventProperties', () => {
  it('returns undefined when given undefined', () => {
    expect(sanitizeEventProperties(undefined)).toBeUndefined()
  })

  it('drops sensitive keys (case-insensitive)', () => {
    const out = sanitizeEventProperties({
      email: 'a@b.com',
      Password: 'secret',
      ACCESSTOKEN: 'abc',
      InviteCode: 'XYZ',
      firstName: 'Anu',
      lastName: 'Tamm',
      household_id: 'hh_1',
      route: '/api/things',
    })
    expect(out).toEqual({ household_id: 'hh_1', route: '/api/things' })
  })

  it('redacts known free-text keys', () => {
    const out = sanitizeEventProperties({
      notes: 'I want spaghetti tonight please',
      description: 'A long description of something',
      route: '/api/things',
    }) as Record<string, string>
    expect(out.notes).toMatch(/^I want spaghetti ton…\[h:[0-9a-f]{8}\]$/)
    expect(out.description).toMatch(/\[h:[0-9a-f]{8}\]$/)
    expect(out.route).toBe('/api/things')
  })

  it('leaves PostHog internal keys (starting with $) alone', () => {
    const out = sanitizeEventProperties({
      $browser_name: 'Chrome',
      $exception_message: 'Boom',
      $current_url: 'https://example.com/foo',
    })
    expect(out).toEqual({
      $browser_name: 'Chrome',
      $exception_message: 'Boom',
      $current_url: 'https://example.com/foo',
    })
  })

  it('leaves enums, ids, counts, and route paths alone', () => {
    const out = sanitizeEventProperties({
      household_id: 'hh_1',
      user_id: 'u_1',
      plan_id: 'p_1',
      meal_id: 'm_1',
      route: '/api/meal-plans/generate',
      feature: 'plan_generate',
      requestId: 'req_1',
      statusCode: 500,
      durationMs: 1234,
    })
    expect(out).toEqual({
      household_id: 'hh_1',
      user_id: 'u_1',
      plan_id: 'p_1',
      meal_id: 'm_1',
      route: '/api/meal-plans/generate',
      feature: 'plan_generate',
      requestId: 'req_1',
      statusCode: 500,
      durationMs: 1234,
    })
  })

  it('does not mutate the input object', () => {
    const input = { email: 'a@b.com', route: '/x' }
    sanitizeEventProperties(input)
    expect(input).toEqual({ email: 'a@b.com', route: '/x' })
  })

  it('does not redact free-text keys when value is not a string', () => {
    const out = sanitizeEventProperties({
      notes: 42,
      description: null,
      route: '/api',
    })
    expect(out).toEqual({ notes: 42, description: null, route: '/api' })
  })
})
