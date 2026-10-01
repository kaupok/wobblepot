import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const env = vi.hoisted(() => ({
  NEXT_PUBLIC_POSTHOG_KEY: undefined as string | undefined,
  POSTHOG_PURGE_API_KEY: undefined as string | undefined,
  POSTHOG_CLI_HOST: undefined as string | undefined,
  POSTHOG_CLI_PROJECT_ID: undefined as string | undefined,
}))

vi.mock('@/lib/env', () => ({ serverEnv: env }))

vi.mock('@/lib/errors', () => ({
  captureApiError: vi.fn(),
}))

import { deletePosthogPersons } from './posthog-purge'
import { captureApiError } from '@/lib/errors'

const mockCapture = vi.mocked(captureApiError)
const fetchMock = vi.fn()

function configure() {
  env.NEXT_PUBLIC_POSTHOG_KEY = 'phc_test'
  env.POSTHOG_PURGE_API_KEY = 'phx_purge'
  env.POSTHOG_CLI_HOST = 'https://eu.posthog.com'
  env.POSTHOG_CLI_PROJECT_ID = '12345'
}

function jsonResponse(body: unknown, status = 202) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('deletePosthogPersons', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    env.NEXT_PUBLIC_POSTHOG_KEY = undefined
    env.POSTHOG_PURGE_API_KEY = undefined
    env.POSTHOG_CLI_HOST = undefined
    env.POSTHOG_CLI_PROJECT_ID = undefined
    // The module skips under Vitest, like getPosthogServer; switch the gate
    // off so the real paths run against the mocked fetch.
    vi.stubEnv('VITEST', '')
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('posts the distinct ids to the bulk delete endpoint with events', async () => {
    configure()
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout')
    fetchMock.mockResolvedValue(
      jsonResponse({ persons_found: 2, persons_queued_for_deletion: 2, deletion_errors: [] }),
    )

    await expect(
      deletePosthogPersons(['user-1', 'household-1'], { userId: 'user-1' }),
    ).resolves.toBe('deleted')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(url.toString()).toBe('https://eu.posthog.com/api/projects/12345/persons/bulk_delete/')
    expect(init.method).toBe('POST')
    expect(init.headers).toMatchObject({ Authorization: 'Bearer phx_purge' })
    expect(JSON.parse(init.body as string)).toEqual({
      distinct_ids: ['user-1', 'household-1'],
      delete_events: true,
    })
    expect(timeoutSpy).toHaveBeenCalledWith(10_000)
    expect(init.signal).toBe(timeoutSpy.mock.results[0]?.value)
    expect(mockCapture).not.toHaveBeenCalled()
  })

  it('treats an id PostHog has never seen as deleted', async () => {
    configure()
    fetchMock.mockResolvedValue(jsonResponse({ persons_found: 0, deletion_errors: [] }))

    await expect(deletePosthogPersons(['user-1'], { userId: 'user-1' })).resolves.toBe('deleted')
  })

  it('skips without a call or a captured error when PostHog is disabled', async () => {
    env.POSTHOG_PURGE_API_KEY = 'phx_purge'

    await expect(deletePosthogPersons(['user-1'], { userId: 'user-1' })).resolves.toBe('skipped')

    expect(fetchMock).not.toHaveBeenCalled()
    expect(mockCapture).not.toHaveBeenCalled()
  })

  it('skips under Vitest without calling PostHog', async () => {
    configure()
    vi.stubEnv('VITEST', 'true')

    await expect(deletePosthogPersons(['user-1'], { userId: 'user-1' })).resolves.toBe('skipped')

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each(['POSTHOG_PURGE_API_KEY', 'POSTHOG_CLI_HOST', 'POSTHOG_CLI_PROJECT_ID'] as const)(
    'skips and captures one error with the user id when %s is unset',
    async (name) => {
      configure()
      env[name] = undefined

      await expect(
        deletePosthogPersons(['user-1', 'household-1'], { userId: 'user-1' }),
      ).resolves.toBe('skipped')

      expect(fetchMock).not.toHaveBeenCalled()
      expect(mockCapture).toHaveBeenCalledTimes(1)
      const [error, context] = mockCapture.mock.calls[0]!
      expect((error as Error).message).toBe(
        'POSTHOG_PURGE_API_KEY is not configured; PostHog person not purged',
      )
      expect(context).toEqual({
        route: '/api/cron/purge-deleted-users',
        userId: 'user-1',
        distinctIds: ['user-1', 'household-1'],
      })
    },
  )

  it.each([401, 403, 404])(
    'skips and captures one error with the ids when PostHog rejects the key or project (%i)',
    async (status) => {
      configure()
      fetchMock.mockResolvedValue(jsonResponse({ detail: 'nope' }, status))

      await expect(
        deletePosthogPersons(['user-1', 'household-1'], { userId: 'user-1' }),
      ).resolves.toBe('skipped')

      expect(mockCapture).toHaveBeenCalledTimes(1)
      const [error, context] = mockCapture.mock.calls[0]!
      expect((error as Error).message).toBe(
        `PostHog purge request rejected (status ${status}); PostHog person not purged`,
      )
      expect(context).toEqual({
        route: '/api/cron/purge-deleted-users',
        userId: 'user-1',
        distinctIds: ['user-1', 'household-1'],
        statusCode: status,
      })
    },
  )

  it('throws on a server error so the next run retries', async () => {
    configure()
    fetchMock.mockResolvedValue(jsonResponse({ detail: 'boom' }, 500))

    await expect(deletePosthogPersons(['user-1'], { userId: 'user-1' })).rejects.toThrow(
      'status 500',
    )
  })

  it('throws when a 2xx response reports deletion errors', async () => {
    configure()
    fetchMock.mockResolvedValue(
      jsonResponse({ persons_found: 1, deletion_errors: [{ person_uuid: 'abc' }] }),
    )

    await expect(deletePosthogPersons(['user-1'], { userId: 'user-1' })).rejects.toThrow(
      '1 deletion error',
    )
  })

  it('throws when the request times out', async () => {
    configure()
    fetchMock.mockRejectedValue(new DOMException('The operation timed out.', 'TimeoutError'))

    await expect(deletePosthogPersons(['user-1'], { userId: 'user-1' })).rejects.toThrow(
      'timed out',
    )
  })

  it('throws on a network error', async () => {
    configure()
    fetchMock.mockRejectedValue(new TypeError('fetch failed'))

    await expect(deletePosthogPersons(['user-1'], { userId: 'user-1' })).rejects.toThrow(
      'fetch failed',
    )
  })
})
