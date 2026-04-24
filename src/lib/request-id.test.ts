import { describe, expect, it } from 'vitest'
import { getRequestId, withRequestId } from '@/lib/request-id'

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
