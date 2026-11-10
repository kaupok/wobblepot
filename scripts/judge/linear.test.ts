import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import {
  AUTO_DRAFTS_QUERY,
  COMMENTS_QUERY,
  fetchCitedText,
  HISTORY_QUERY,
  ISSUE_QUERY,
  linearClient,
  readApiKey,
  statusAt,
} from './linear'

const envFile = (content: string) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'judge-linear-'))
  const file = path.join(dir, '.env')
  fs.writeFileSync(file, content)
  return file
}

describe('readApiKey', () => {
  it('prefers the environment', () => {
    expect(readApiKey({ env: { LINEAR_API_KEY: 'from-env' }, envFile: '/nonexistent' })).toBe(
      'from-env',
    )
  })

  it('reads the .env line with its quotes removed', () => {
    const file = envFile('OTHER=1\nLINEAR_API_KEY="lin_api_x"\n')
    expect(readApiKey({ env: {}, envFile: file })).toBe('lin_api_x')
  })

  it('names the variable and the setup doc when no key is set', () => {
    expect(() => readApiKey({ env: {}, envFile: envFile('OTHER=1\n') })).toThrow(
      'LINEAR_API_KEY is not set. Set LINEAR_API_KEY in the environment or in .env at the repository root (docs/ENVIRONMENT_SETUP.md).',
    )
  })
})

describe('linearClient', () => {
  it('sends the key bare and refuses a mutation before any request', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ data: { ok: true } })))
    const query = linearClient({
      fetch: fetch as unknown as typeof globalThis.fetch,
      env: { LINEAR_API_KEY: 'k1' },
      envFile: '/nonexistent',
    })
    await expect(query('mutation { issueDelete(id: "x") { success } }')).rejects.toThrow(
      'never a mutation',
    )
    expect(fetch).not.toHaveBeenCalled()
    expect(await query('query Q { viewer { id } }')).toEqual({ ok: true })
    const init = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(init[0]).toBe('https://api.linear.app/graphql')
    expect((init[1].headers as Record<string, string>).Authorization).toBe('k1')
  })

  it('holds no mutation in any query it can send', () => {
    for (const q of [AUTO_DRAFTS_QUERY, ISSUE_QUERY, COMMENTS_QUERY, HISTORY_QUERY]) {
      expect(q).not.toMatch(/mutation/i)
    }
  })
})

describe('statusAt', () => {
  const changes = [
    {
      createdAt: '2026-11-05T00:00:00.000Z',
      fromState: { name: 'Backlog' },
      toState: { name: 'Done' },
    },
    {
      createdAt: '2026-11-01T00:00:00.000Z',
      fromState: { name: 'Triage' },
      toState: { name: 'Backlog' },
    },
    { createdAt: '2026-11-03T00:00:00.000Z', fromState: null, toState: null },
  ]

  it('takes the last state change before the date', () => {
    expect(statusAt(changes, '2026-11-04T00:00:00.000Z', 'Done')).toBe('Backlog')
  })

  it('takes the state the first change left when the date is before every change', () => {
    expect(statusAt(changes, '2026-10-01T00:00:00.000Z', 'Done')).toBe('Triage')
  })

  it('keeps the current state when the issue never changed state', () => {
    expect(statusAt([], '2026-10-01T00:00:00.000Z', 'Todo')).toBe('Todo')
  })
})

describe('fetchCitedText', () => {
  const issue = {
    identifier: 'HON-9',
    title: 'T',
    description: 'The description.',
    createdAt: '2026-11-01T00:00:00.000Z',
    state: { name: 'Done' },
    labels: { nodes: [] },
  }
  const comments = [
    [{ createdAt: '2026-11-02T00:00:00.000Z', body: 'First comment.' }],
    [{ createdAt: '2026-11-06T00:00:00.000Z', body: '## Judge: Hold — no precedent' }],
  ]
  const history = [
    {
      createdAt: '2026-11-05T00:00:00.000Z',
      fromState: { name: 'Backlog' },
      toState: { name: 'Done' },
    },
  ]
  const query = vi.fn(async (q: string, v: Record<string, unknown> = {}) => {
    if (q.startsWith('query Issue')) return { issue }
    if (q.startsWith('query History')) {
      return {
        issue: { history: { nodes: history, pageInfo: { hasNextPage: false, endCursor: null } } },
      }
    }
    const n = v.after === null ? 0 : 1
    return {
      issue: {
        comments: {
          nodes: comments[n],
          pageInfo: { hasNextPage: n === 0, endCursor: n === 0 ? 'c1' : null },
        },
      },
    }
  })

  it('writes Status on line 1, the description, then every comment from every page', async () => {
    expect(await fetchCitedText(query, 'HON-9')).toBe(
      [
        'Status: Done',
        '',
        'The description.',
        '',
        '--- Comment 2026-11-02T00:00:00.000Z',
        'First comment.',
        '',
        '--- Comment 2026-11-06T00:00:00.000Z',
        '## Judge: Hold — no precedent',
        '',
      ].join('\n'),
    )
  })

  it('with before, keeps earlier comments and the status at that date', async () => {
    const text = await fetchCitedText(query, 'HON-9', '2026-11-04T00:00:00.000Z')
    expect(text?.split('\n')[0]).toBe('Status: Backlog')
    expect(text).toContain('First comment.')
    expect(text).not.toContain('## Judge:')
  })

  it('with before, returns null for an issue created after the date', async () => {
    expect(await fetchCitedText(query, 'HON-9', '2026-10-01T00:00:00.000Z')).toBeNull()
  })
})
