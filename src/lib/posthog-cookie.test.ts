import { describe, expect, it } from 'vitest'
import { clientSessionProperties, parsePosthogCookie } from './posthog-cookie'

// posthog-js persists `$sesid` as [lastActivityTimestamp, sessionId, sessionStartTimestamp].
function posthogCookie(value: Record<string, unknown>, name = 'ph_phc_TOKEN_posthog'): string {
  return `${name}=${encodeURIComponent(JSON.stringify(value))}`
}

const SESSION = {
  distinct_id: 'user-42',
  $sesid: [1_700_000_000_500, 'sess-abc', 1_700_000_000_000],
}

describe('parsePosthogCookie', () => {
  it('reads the distinct id and session id from a PostHog cookie among others', () => {
    expect(parsePosthogCookie(`theme=dark; ${posthogCookie(SESSION)}; foo=bar`)).toEqual({
      distinctId: 'user-42',
      sessionId: 'sess-abc',
    })
  })

  it('handles a cookie header passed as an array', () => {
    expect(parsePosthogCookie(['foo=bar', posthogCookie(SESSION, 'ph_phc_X_posthog')])).toEqual({
      distinctId: 'user-42',
      sessionId: 'sess-abc',
    })
  })

  it('returns nothing when the header or the PostHog cookie is missing', () => {
    expect(parsePosthogCookie(undefined)).toEqual({})
    expect(parsePosthogCookie(null)).toEqual({})
    expect(parsePosthogCookie('theme=dark')).toEqual({})
  })

  it('skips a malformed PostHog cookie', () => {
    expect(parsePosthogCookie('ph_phc_TOKEN_posthog=not-json')).toEqual({})
  })

  it('keeps scanning past a PostHog cookie with neither field', () => {
    const header = `${posthogCookie({ other: 1 }, 'ph_phc_A_posthog')}; ${posthogCookie(SESSION, 'ph_phc_B_posthog')}`
    expect(parsePosthogCookie(header)).toEqual({ distinctId: 'user-42', sessionId: 'sess-abc' })
  })

  it('omits the session id when $sesid is missing or malformed', () => {
    expect(parsePosthogCookie(posthogCookie({ distinct_id: 'u' }))).toEqual({ distinctId: 'u' })
    expect(parsePosthogCookie(posthogCookie({ distinct_id: 'u', $sesid: 'sess' }))).toEqual({
      distinctId: 'u',
    })
    // posthog-js writes `[null, null, null]` after a reset.
    expect(
      parsePosthogCookie(posthogCookie({ distinct_id: 'u', $sesid: [null, null, null] })),
    ).toEqual({
      distinctId: 'u',
    })
  })

  it('omits a distinct id that is not a string', () => {
    expect(parsePosthogCookie(posthogCookie({ distinct_id: 42, $sesid: [1, 's', 1] }))).toEqual({
      sessionId: 's',
    })
  })
})

describe('clientSessionProperties', () => {
  // A header map with lower-case names, read the way both callers read theirs.
  const propertiesFor = (headers: Record<string, string>) =>
    clientSessionProperties((name) => headers[name])
  const host = 'wobblepot.com'

  it('returns $session_id and the same-origin Referer as $current_url', () => {
    expect(
      propertiesFor({
        cookie: posthogCookie(SESSION),
        referer: 'https://wobblepot.com/plan',
        host,
      }),
    ).toEqual({ $session_id: 'sess-abc', $current_url: 'https://wobblepot.com/plan' })
  })

  it('strips the query string, so a reset token never reaches PostHog', () => {
    expect(
      propertiesFor({ referer: 'https://wobblepot.com/reset-password?token=secret#x', host }),
    ).toEqual({ $current_url: 'https://wobblepot.com/reset-password' })
  })

  it('replaces the invite code in the path', () => {
    expect(propertiesFor({ referer: 'https://wobblepot.com/invite/XYZ123', host })).toEqual({
      $current_url: 'https://wobblepot.com/invite/:code',
    })
  })

  it('drops a cross-origin Referer', () => {
    expect(
      propertiesFor({ cookie: posthogCookie(SESSION), referer: 'https://www.google.com/', host }),
    ).toEqual({ $session_id: 'sess-abc' })
  })

  it('drops the Referer when the host is unknown or the Referer is not a URL', () => {
    expect(propertiesFor({ referer: 'https://wobblepot.com/plan' })).toEqual({})
    expect(propertiesFor({ referer: '/plan', host })).toEqual({})
  })

  it.each([
    ['a page load', { 'sec-fetch-dest': 'document' }],
    ['an RSC navigation', { rsc: '1' }],
  ])('drops the Referer on %s, where it names the previous page', (_, extra) => {
    expect(
      propertiesFor({
        cookie: posthogCookie(SESSION),
        referer: 'https://wobblepot.com/previous',
        host,
        ...extra,
      }),
    ).toEqual({ $session_id: 'sess-abc' })
  })

  it('keeps the Referer on a fetch from a page', () => {
    expect(
      propertiesFor({ referer: 'https://wobblepot.com/plan', host, 'sec-fetch-dest': 'empty' }),
    ).toEqual({ $current_url: 'https://wobblepot.com/plan' })
  })

  it('returns an empty object when nothing is known (no consent, no Referer)', () => {
    expect(propertiesFor({ host })).toEqual({})
  })
})
