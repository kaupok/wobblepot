import { describe, expect, it } from 'vitest'
import {
  redactFreeText,
  redactUrlProperties,
  redactUrlValue,
  sanitizeEventProperties,
} from './redact'

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
      Username: 'anu123',
      household_id: 'hh_1',
      route: '/api/things',
    })
    expect(out).toEqual({ household_id: 'hh_1', route: '/api/things' })
  })

  it('preserves a top-level `name` property (e.g. meal name)', () => {
    const out = sanitizeEventProperties({
      name: 'Spaghetti Bolognese',
      route: '/api/meals',
    })
    expect(out).toEqual({ name: 'Spaghetti Bolognese', route: '/api/meals' })
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

  // Regression-guard for HON-528: the `token` strip is intentional. posthog-js
  // stamps the project api key at properties.token, but the PostHogProvider
  // before_send re-adds it after sanitization (see PostHogProvider.tsx). If
  // this redactor is ever loosened to pass `token` through, captureException
  // payloads carrying user-supplied OAuth tokens would leak.
  it('strips a top-level `token` key', () => {
    const out = sanitizeEventProperties({ token: 'phc_xxx', other: 'x' })
    expect(out).toEqual({ other: 'x' })
  })
})

describe('redactUrlValue', () => {
  it('drops the query string and fragment from an absolute URL', () => {
    expect(redactUrlValue('https://wobblepot.com/reset-password?token=abc#top')).toBe(
      'https://wobblepot.com/reset-password',
    )
  })

  it('drops the query string from a path', () => {
    expect(redactUrlValue('/reset-password?token=abc')).toBe('/reset-password')
  })

  it('drops a fragment that comes before any query string', () => {
    expect(redactUrlValue('/meal-plan#token=abc?x=1')).toBe('/meal-plan')
  })

  it('replaces the invite code in the path', () => {
    expect(redactUrlValue('https://wobblepot.com/invite/XYZ123')).toBe(
      'https://wobblepot.com/invite/:code',
    )
    expect(redactUrlValue('/invite/XYZ123/')).toBe('/invite/:code/')
  })

  it('replaces the invite code in the invites API path', () => {
    expect(redactUrlValue('/api/invites/XYZ123?x=1')).toBe('/api/invites/:code')
  })

  it('keeps a household invite id, which is not a secret', () => {
    expect(redactUrlValue('/api/households/me/invites/inv_1')).toBe(
      '/api/households/me/invites/inv_1',
    )
  })

  it('keeps a path without a query string unchanged', () => {
    expect(redactUrlValue('https://wobblepot.com/meal-plan')).toBe(
      'https://wobblepot.com/meal-plan',
    )
  })

  it('drops credentials from an absolute URL', () => {
    expect(redactUrlValue('https://user:pass@api.example.com/x?key=1')).toBe(
      'https://api.example.com/x',
    )
  })

  it('passes a value that is not a URL through unchanged', () => {
    expect(redactUrlValue('$direct')).toBe('$direct')
  })
})

describe('redactUrlProperties', () => {
  it('redacts every URL-valued key and leaves the rest alone', () => {
    const out = redactUrlProperties({
      $current_url: 'https://wobblepot.com/reset-password?token=abc',
      $pathname: '/invite/XYZ123',
      $referrer: 'https://wobblepot.com/sign-in?returnUrl=/invite/XYZ123',
      $prev_pageview_pathname: '/invite/XYZ123',
      $session_entry_url: 'https://wobblepot.com/reset-password?token=abc',
      $session_entry_pathname: '/invite/XYZ123',
      $session_entry_referrer: 'https://mail.example.com/?token=abc',
      path: '/reset-password?token=abc',
      url: 'https://api.example.com/x?key=1',
      $referring_domain: 'wobblepot.com',
      utm_source: 'newsletter',
    })

    expect(out).toEqual({
      $current_url: 'https://wobblepot.com/reset-password',
      $pathname: '/invite/:code',
      $referrer: 'https://wobblepot.com/sign-in',
      $prev_pageview_pathname: '/invite/:code',
      $session_entry_url: 'https://wobblepot.com/reset-password',
      $session_entry_pathname: '/invite/:code',
      $session_entry_referrer: 'https://mail.example.com/',
      path: '/reset-password',
      url: 'https://api.example.com/x',
      $referring_domain: 'wobblepot.com',
      utm_source: 'newsletter',
    })
  })

  it('redacts person properties nested under $set and $set_once', () => {
    const out = redactUrlProperties({
      $set: { $current_url: '/invite/XYZ123' },
      $set_once: {
        $initial_current_url: 'https://wobblepot.com/reset-password?token=abc',
        $initial_pathname: '/invite/XYZ123',
        $initial_referrer: '$direct',
      },
    })

    expect(out).toEqual({
      $set: { $current_url: '/invite/:code' },
      $set_once: {
        $initial_current_url: 'https://wobblepot.com/reset-password',
        $initial_pathname: '/invite/:code',
        $initial_referrer: '$direct',
      },
    })
  })

  it('leaves non-string values alone', () => {
    expect(redactUrlProperties({ url: 42, path: null })).toEqual({ url: 42, path: null })
  })

  it('does not mutate its input', () => {
    const input = { $current_url: '/reset-password?token=abc' }
    redactUrlProperties(input)
    expect(input.$current_url).toBe('/reset-password?token=abc')
  })

  it('passes undefined through', () => {
    expect(redactUrlProperties(undefined)).toBeUndefined()
  })
})
