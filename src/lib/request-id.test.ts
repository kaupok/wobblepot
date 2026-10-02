import { describe, expect, it, vi } from 'vitest'

const { headersMock } = vi.hoisted(() => ({
  // Outside a request, Next's `headers()` throws; the default mirrors that.
  headersMock: vi.fn<() => Promise<Headers>>(() => {
    throw new Error('`headers` was called outside a request scope')
  }),
}))

vi.mock('next/headers', () => ({ headers: headersMock }))
import { getClientSession, getRequestId, withRequestId } from '@/lib/request-id'

describe('withRequestId / getRequestId', () => {
  it('returns undefined outside a wrapped scope', () => {
    expect(getRequestId()).toBeUndefined()
  })

  it('returns the same id throughout a single wrapped call', async () => {
    const seen: Array<string | undefined> = []
    const wrapped = withRequestId(async () => {
      seen.push(getRequestId())
      await Promise.resolve()
      seen.push(getRequestId())
      await new Promise((r) => setTimeout(r, 1))
      seen.push(getRequestId())
      return new Response(null)
    })

    await wrapped()

    expect(seen).toHaveLength(3)
    expect(seen[0]).toBeDefined()
    expect(seen[0]).toMatch(/^[0-9a-f-]{36}$/)
    expect(seen[1]).toBe(seen[0])
    expect(seen[2]).toBe(seen[0])
  })

  it('produces distinct ids for two concurrent invocations', async () => {
    const wrapped = withRequestId(async () => {
      const first = getRequestId()
      await new Promise((r) => setTimeout(r, 10))
      const second = getRequestId()
      return new Response(JSON.stringify({ first, second }))
    })

    const [a, b] = await Promise.all([wrapped(), wrapped()])
    const aBody = (await a.json()) as { first: string; second: string }
    const bBody = (await b.json()) as { first: string; second: string }

    expect(aBody.first).toBe(aBody.second)
    expect(bBody.first).toBe(bBody.second)
    expect(aBody.first).not.toBe(bBody.first)
  })

  it('does not leak the id after the wrapped call resolves', async () => {
    const wrapped = withRequestId(async () => new Response(null))
    await wrapped()
    expect(getRequestId()).toBeUndefined()
  })
})

describe('getClientSession', () => {
  const cookie = `ph_phc_TOKEN_posthog=${encodeURIComponent(
    JSON.stringify({ distinct_id: 'u', $sesid: [2, 'sess-abc', 1] }),
  )}`

  it('resolves to an empty object outside a request scope', async () => {
    await expect(getClientSession()).resolves.toEqual({})
  })

  it('reads the session id and the Referer of a fetch from a page', async () => {
    headersMock.mockResolvedValueOnce(
      new Headers({
        cookie,
        referer: 'https://wobblepot.com/plan?token=secret',
        host: 'wobblepot.com',
        'sec-fetch-dest': 'empty',
      }),
    )
    await expect(getClientSession()).resolves.toEqual({
      $session_id: 'sess-abc',
      $current_url: 'https://wobblepot.com/plan',
    })
  })

  it.each([
    ['a page load', { 'sec-fetch-dest': 'document' }],
    ['an RSC navigation', { rsc: '1' }],
  ])('drops the Referer on %s, where it names the previous page', async (_, extra) => {
    headersMock.mockResolvedValueOnce(
      new Headers({
        cookie,
        referer: 'https://wobblepot.com/previous',
        host: 'wobblepot.com',
        ...extra,
      }),
    )
    await expect(getClientSession()).resolves.toEqual({ $session_id: 'sess-abc' })
  })
})
