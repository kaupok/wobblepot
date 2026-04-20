import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $queryRaw: vi.fn(),
    session: { count: vi.fn() },
  },
}))

vi.mock('@/lib/env', () => ({
  serverEnv: {
    ANTHROPIC_API_KEY: 'test-key',
    STATUS_INCIDENT_MESSAGE: undefined,
  },
}))

vi.mock('ai', () => ({
  generateObject: vi.fn(),
}))

vi.mock('@ai-sdk/anthropic', () => ({
  createAnthropic: () => (modelId: string) => ({ modelId }),
}))

import { prisma } from '@/lib/prisma'
import { generateObject } from 'ai'
import {
  probeDatabase,
  probeAuth,
  probeAi,
  computeOverall,
  getStatusSnapshot,
  __resetProbeCache,
} from './probes'

const mockQueryRaw = vi.mocked(prisma.$queryRaw)
const mockSessionCount = vi.mocked(prisma.session.count)
const mockGenerateObject = vi.mocked(generateObject)

describe('probeDatabase', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    __resetProbeCache()
  })

  it('returns ok when the query succeeds', async () => {
    mockQueryRaw.mockResolvedValueOnce([{ '?column?': 1 }])

    const result = await probeDatabase()

    expect(result.status).toBe('ok')
    expect(result.error).toBeUndefined()
    expect(result.latencyMs).toBeGreaterThanOrEqual(0)
    expect(typeof result.checkedAt).toBe('string')
  })

  it('returns down when the query rejects', async () => {
    mockQueryRaw.mockRejectedValueOnce(new Error('Connection refused'))

    const result = await probeDatabase()

    expect(result.status).toBe('down')
    expect(result.error).toBe('Connection refused')
  })

  it('returns down when the query hangs past the timeout', async () => {
    mockQueryRaw.mockImplementationOnce(
      () => new Promise((resolve) => setTimeout(resolve, 5000)) as never,
    )

    const result = await probeDatabase()

    expect(result.status).toBe('down')
    expect(result.error).toMatch(/timeout/i)
  }, 10_000)
})

describe('probeAuth', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    __resetProbeCache()
  })

  it('returns ok when session count succeeds', async () => {
    mockSessionCount.mockResolvedValueOnce(42)

    const result = await probeAuth()

    expect(result.status).toBe('ok')
  })

  it('returns down when session count rejects', async () => {
    mockSessionCount.mockRejectedValueOnce(new Error('table missing'))

    const result = await probeAuth()

    expect(result.status).toBe('down')
    expect(result.error).toBe('table missing')
  })

  it('returns down on timeout', async () => {
    mockSessionCount.mockImplementationOnce(
      () => new Promise((resolve) => setTimeout(() => resolve(1), 5000)) as never,
    )

    const result = await probeAuth()

    expect(result.status).toBe('down')
    expect(result.error).toMatch(/timeout/i)
  }, 10_000)
})

describe('probeAi', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    __resetProbeCache()
  })

  it('returns ok when generateObject resolves', async () => {
    mockGenerateObject.mockResolvedValueOnce({
      object: { ok: true },
      usage: { inputTokens: 10, outputTokens: 2 },
    } as never)

    const result = await probeAi()

    expect(result.status).toBe('ok')
    expect(mockGenerateObject).toHaveBeenCalledTimes(1)
  })

  it('returns down when generateObject rejects', async () => {
    mockGenerateObject.mockRejectedValueOnce(new Error('API error'))

    const result = await probeAi()

    expect(result.status).toBe('down')
    expect(result.error).toBe('API error')
  })
})

describe('probe cache', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    __resetProbeCache()
  })

  it('reuses the cached result within the 60s TTL', async () => {
    mockQueryRaw.mockResolvedValueOnce([{ '?column?': 1 }])

    const first = await probeDatabase()
    const second = await probeDatabase()

    expect(first).toEqual(second)
    expect(mockQueryRaw).toHaveBeenCalledTimes(1)
  })

  it('re-runs the probe after the cache is cleared', async () => {
    mockQueryRaw.mockResolvedValueOnce([{ '?column?': 1 }])
    await probeDatabase()

    __resetProbeCache()
    mockQueryRaw.mockResolvedValueOnce([{ '?column?': 1 }])
    await probeDatabase()

    expect(mockQueryRaw).toHaveBeenCalledTimes(2)
  })
})

describe('computeOverall', () => {
  const base = { checkedAt: 'now', latencyMs: 1 } as const

  it('returns ok when every component is ok', () => {
    expect(
      computeOverall({
        db: { status: 'ok', ...base },
        auth: { status: 'ok', ...base },
        ai: { status: 'ok', ...base },
      }),
    ).toBe('ok')
  })

  it('returns degraded when some are down', () => {
    expect(
      computeOverall({
        db: { status: 'ok', ...base },
        auth: { status: 'down', ...base },
        ai: { status: 'ok', ...base },
      }),
    ).toBe('degraded')
  })

  it('returns down when every component is down', () => {
    expect(
      computeOverall({
        db: { status: 'down', ...base },
        auth: { status: 'down', ...base },
        ai: { status: 'down', ...base },
      }),
    ).toBe('down')
  })
})

describe('getStatusSnapshot', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    __resetProbeCache()
  })

  afterEach(() => {
    __resetProbeCache()
  })

  it('returns all three component probes plus a timestamp', async () => {
    mockQueryRaw.mockResolvedValueOnce([{ '?column?': 1 }])
    mockSessionCount.mockResolvedValueOnce(1)
    mockGenerateObject.mockResolvedValueOnce({
      object: { ok: true },
      usage: { inputTokens: 5, outputTokens: 1 },
    } as never)

    const snapshot = await getStatusSnapshot()

    expect(snapshot.db.status).toBe('ok')
    expect(snapshot.auth.status).toBe('ok')
    expect(snapshot.ai.status).toBe('ok')
    expect(typeof snapshot.timestamp).toBe('string')
    expect(snapshot.incidentMessage).toBeUndefined()
  })
})
