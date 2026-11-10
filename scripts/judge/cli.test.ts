import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { run } from './cli'
import type { LinearDeps } from './linear'

let tmp: string

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'judge-cli-'))
})

afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true })
})

function fixture(name: string, value: unknown): string {
  const file = path.join(tmp, name)
  fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value))
  return file
}

describe('judge cli', () => {
  it('gate: reads label objects as Linear returns them', async () => {
    const issue = fixture('issue.json', {
      title: '[AUTO DRAFT] Thing',
      description: 'plain',
      labels: [{ name: 'GTM' }],
    })
    expect(await run(['gate', '--issue', issue])).toEqual({
      gate: { gate: 'gtm', kind: 'label', matched: 'GTM' },
    })
  })

  it('finalize: holds a hand-edited verdict whose quote is not in CLAUDE.md at HEAD', async () => {
    const verdict = fixture('verdict.json', {
      issue: 'HON-1456',
      move: 'decide',
      outcome: 'real',
      citations: [{ source: 'CLAUDE.md → Testing', quote: 'A test may always pass.' }],
      reasoning: 'Edited by hand.',
    })
    const result = (await run(['finalize', '--verdict', verdict, '--ref', 'HEAD'])) as {
      heading: string
    }
    expect(result.heading).toBe('## Judge: Hold — no verifiable precedent')
  })

  it('finalize: keeps a verdict whose quote is in CLAUDE.md at HEAD', async () => {
    const verdict = fixture('verdict-ok.json', {
      issue: 'HON-1456',
      move: 'decide',
      outcome: 'real',
      citations: [{ source: 'CLAUDE.md → Testing', quote: 'A test must be able to fail.' }],
      reasoning: 'Real quote.',
    })
    const result = (await run(['finalize', '--verdict', verdict, '--ref', 'HEAD'])) as {
      heading: string
    }
    expect(result.heading).toBe('## Judge: Decide — real')
  })

  it('select: reads { issues: [] } and the --rejudge flag', async () => {
    const list = fixture('list.json', {
      issues: [{ id: 'HON-2', title: '[AUTO DRAFT] B', labels: ['Judge: real'] }],
    })
    expect(await run(['select', '--issues', list])).toMatchObject({ selected: [] })
    expect(await run(['select', '--issues', list, '--rejudge'])).toMatchObject({
      selected: ['HON-2'],
    })
  })

  it('throws the usage on an unknown command', async () => {
    await expect(run(['nope'])).rejects.toThrow('Usage:')
  })
})

interface FakeIssue {
  identifier: string
  title: string
  description: string
  createdAt: string
  state: { name: string }
  labels: { nodes: { name: string }[] }
  comments: { createdAt: string; body: string }[]
}

const page = <T>(nodes: T[], endCursor: string | null = null) => ({
  nodes,
  pageInfo: { hasNextPage: endCursor !== null, endCursor },
})

/** A stand-in for the Linear API, so no test calls the network. */
function fakeLinear(issues: FakeIssue[], draftPages: FakeIssue[][] = [issues]) {
  const bodies: { query: string; variables: Record<string, unknown> }[] = []
  const fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as (typeof bodies)[number]
    bodies.push(body)
    const { query, variables } = body
    const issue = issues.find((i) => i.identifier === variables.id) ?? null
    if (variables.id !== undefined && !issue) {
      // What the live API returns for an unknown ID (checked 2026-11-10).
      return new Response(
        JSON.stringify({ data: null, errors: [{ message: 'Entity not found: Issue' }] }),
      )
    }
    let data: unknown
    if (query.startsWith('query AutoDrafts')) {
      const n = variables.after === null ? 0 : Number(variables.after)
      const nodes = draftPages[n] ?? []
      data = { issues: page(nodes, n + 1 < draftPages.length ? String(n + 1) : null) }
    } else if (query.startsWith('query Issue')) {
      data = { issue }
    } else if (query.startsWith('query Comments')) {
      data = { issue: { comments: page(issue?.comments ?? []) } }
    } else {
      data = { issue: { history: page([]) } }
    }
    return new Response(JSON.stringify({ data }))
  })
  const deps: LinearDeps = {
    fetch: fetch as unknown as typeof globalThis.fetch,
    env: { LINEAR_API_KEY: 'lin_api_secret' },
    envFile: '/nonexistent/.env',
  }
  return { deps, fetch, bodies }
}

const fakeIssue = (id: string, status: string, extra: Partial<FakeIssue> = {}): FakeIssue => ({
  identifier: id,
  title: `[AUTO DRAFT] ${id}`,
  description: `${id} description`,
  createdAt: '2026-11-01T00:00:00.000Z',
  state: { name: status },
  labels: { nodes: [] },
  comments: [],
  ...extra,
})

describe('judge cli: Linear commands', () => {
  it('list: reads every page and drops Done, Canceled and Duplicate issues', async () => {
    const { deps, bodies } = fakeLinear(
      [],
      [
        [fakeIssue('HON-1', 'Backlog'), fakeIssue('HON-2', 'Done')],
        [
          fakeIssue('HON-3', 'Canceled'),
          fakeIssue('HON-4', 'Duplicate'),
          fakeIssue('HON-5', 'Todo', { labels: { nodes: [{ name: 'Judge: real' }] } }),
        ],
      ],
    )
    const out = path.join(tmp, 'drafts.json')
    expect(await run(['list', '--out', out], deps)).toEqual({ out, ids: ['HON-1', 'HON-5'] })
    expect(JSON.parse(fs.readFileSync(out, 'utf8'))).toEqual([
      { id: 'HON-1', title: '[AUTO DRAFT] HON-1', labels: [] },
      { id: 'HON-5', title: '[AUTO DRAFT] HON-5', labels: ['Judge: real'] },
    ])
    expect(bodies.map((b) => b.variables.after)).toEqual([null, '1'])
  })

  it('list --id: writes that one issue in the shape select reads', async () => {
    const { deps } = fakeLinear([fakeIssue('HON-8', 'Done')])
    const out = path.join(tmp, 'one.json')
    await run(['list', '--id', 'HON-8', '--out', out], deps)
    expect(JSON.parse(fs.readFileSync(out, 'utf8'))).toEqual([
      { id: 'HON-8', title: '[AUTO DRAFT] HON-8', labels: [] },
    ])
  })

  it('issue: writes a file that gate --issue accepts unchanged', async () => {
    const { deps } = fakeLinear([
      fakeIssue('HON-7', 'Backlog', { labels: { nodes: [{ name: 'GTM' }] } }),
    ])
    const out = path.join(tmp, 'issue-7.json')
    await run(['issue', '--id', 'HON-7', '--out', out], deps)
    expect(JSON.parse(fs.readFileSync(out, 'utf8'))).toEqual({
      title: '[AUTO DRAFT] HON-7',
      description: 'HON-7 description',
      labels: ['GTM'],
    })
    expect(await run(['gate', '--issue', out])).toEqual({
      gate: { gate: 'gtm', kind: 'label', matched: 'GTM' },
    })
  })

  it('cite: writes each cited issue and duplicateOf, never the judged issue', async () => {
    const { deps } = fakeLinear([
      fakeIssue('HON-900', 'Backlog'),
      fakeIssue('HON-901', 'Done'),
      fakeIssue('HON-1456', 'Backlog'),
    ])
    const verdict = fixture('cite-dup.json', {
      issue: 'HON-1456',
      move: 'send_back',
      sendBackReason: 'duplicate',
      duplicateOf: 'HON-901',
      citations: [
        { source: 'HON-900 comment', quote: 'the same toast is tracked there' },
        { source: 'HON-1456 description', quote: 'the judged issue says this itself' },
      ],
      reasoning: 'Same finding.',
    })
    const dir = path.join(tmp, 'linear-dup')
    expect(await run(['cite', '--verdict', verdict, '--linear-dir', dir], deps)).toEqual({
      written: ['HON-900', 'HON-901'],
      skipped: [],
    })
    expect(fs.readdirSync(dir).sort()).toEqual(['HON-900.txt', 'HON-901.txt'])
    expect(fs.readFileSync(path.join(dir, 'HON-901.txt'), 'utf8').split('\n')[0]).toBe(
      'Status: Done',
    )
  })

  it('cite: finalize verifies an MCP-form quote from the file cite wrote', async () => {
    const { deps } = fakeLinear([
      fakeIssue('HON-900', 'Backlog', {
        comments: [
          {
            createdAt: '2026-11-02T10:00:00.000Z',
            body: 'We keep the double tap on purpose, see [HON-1603](https://linear.app/honkadori/issue/HON-1603/x) for the spec.',
          },
        ],
      }),
    ])
    const verdict = fixture('cite-decide.json', {
      issue: 'HON-1456',
      move: 'decide',
      outcome: 'wont_fix',
      citations: [
        {
          source: 'HON-900 comment',
          quote:
            'We keep the double tap on purpose, see <issue id="ffd04100" label="HON-1603" href="https://linear.app/honkadori/issue/HON-1603/x" /> for the spec.',
        },
      ],
      reasoning: 'Recorded decision.',
    })
    const dir = path.join(tmp, 'linear-decide')
    await run(['cite', '--verdict', verdict, '--linear-dir', dir], deps)
    const result = (await run([
      'finalize',
      '--verdict',
      verdict,
      '--ref',
      'HEAD',
      '--linear-dir',
      dir,
    ])) as { heading: string; dropped: unknown[] }
    expect(result.dropped).toEqual([])
    expect(result.heading).toBe("## Judge: Decide — won't fix")
  })

  it('cite: skips an unknown cited ID, so finalize drops only that citation', async () => {
    const { deps } = fakeLinear([
      fakeIssue('HON-900', 'Backlog', { description: 'We keep the double tap on purpose here.' }),
    ])
    const verdict = fixture('cite-unknown.json', {
      issue: 'HON-1456',
      move: 'decide',
      outcome: 'wont_fix',
      citations: [
        { source: 'HON-900 description', quote: 'We keep the double tap on purpose here.' },
        { source: 'HON-99999 comment', quote: 'an invented precedent from nowhere' },
      ],
      reasoning: 'Recorded decision.',
    })
    const dir = path.join(tmp, 'linear-unknown')
    expect(await run(['cite', '--verdict', verdict, '--linear-dir', dir], deps)).toEqual({
      written: ['HON-900'],
      skipped: [{ id: 'HON-99999', reason: 'not found in Linear' }],
    })
    const result = (await run([
      'finalize',
      '--verdict',
      verdict,
      '--ref',
      'HEAD',
      '--linear-dir',
      dir,
    ])) as { heading: string; dropped: { reason: string }[] }
    expect(result.heading).toBe("## Judge: Decide — won't fix")
    expect(result.dropped.map((d) => d.reason)).toEqual(['HON-99999 was not fetched'])
  })

  it('issue: an unknown ID fails with not found, not a key error', async () => {
    const { deps } = fakeLinear([])
    await expect(
      run(['issue', '--id', 'HON-99999', '--out', path.join(tmp, 'none.json')], deps),
    ).rejects.toThrow('HON-99999 not found in Linear')
  })

  it.each([
    ['list', '--out', '/tmp/judge-never-written.json'],
    ['issue', '--id', 'HON-7', '--out', '/tmp/judge-never-written.json'],
    ['cite', '--verdict', 'VERDICT', '--linear-dir', '/tmp/judge-never-written'],
  ])('%s: with no key, fails before any request and names LINEAR_API_KEY', async (...args) => {
    const { deps, fetch } = fakeLinear([])
    const verdict = fixture('cite-nokey.json', {
      issue: 'HON-1456',
      move: 'decide',
      outcome: 'real',
      citations: [{ source: 'HON-900 comment', quote: 'one two three four five' }],
      reasoning: 'r',
    })
    const argv = args.map((a) => (a === 'VERDICT' ? verdict : a))
    await expect(run(argv, { ...deps, env: {} })).rejects.toThrow(
      /LINEAR_API_KEY.*docs\/ENVIRONMENT_SETUP\.md/,
    )
    expect(fetch).not.toHaveBeenCalled()
  })

  it('reports an API error with the variable name and without the key', async () => {
    const { deps } = fakeLinear([])
    const failing = vi.fn(
      async () =>
        new Response(JSON.stringify({ errors: [{ message: 'Authentication required' }] }), {
          status: 401,
        }),
    )
    const error = await run(['list', '--out', path.join(tmp, 'x.json')], {
      ...deps,
      fetch: failing as unknown as typeof globalThis.fetch,
    }).catch((e: unknown) => e as Error)
    expect((error as Error).message).toMatch(/Authentication required.*LINEAR_API_KEY/)
    expect((error as Error).message).not.toContain('lin_api_secret')
  })

  it('sends no mutation in any request', async () => {
    const { deps, bodies } = fakeLinear([fakeIssue('HON-900', 'Backlog')])
    const verdict = fixture('cite-q.json', {
      issue: 'HON-1456',
      move: 'decide',
      outcome: 'real',
      citations: [{ source: 'HON-900 comment', quote: 'one two three four five' }],
      reasoning: 'r',
    })
    await run(['list', '--out', path.join(tmp, 'q.json')], deps)
    await run(['issue', '--id', 'HON-900', '--out', path.join(tmp, 'q-issue.json')], deps)
    const dir = path.join(tmp, 'linear-q')
    await run(['cite', '--verdict', verdict, '--linear-dir', dir, '--before', '2026-12-01'], deps)
    expect(new Set(bodies.map((b) => b.query.split(/[ (]/)[1]))).toEqual(
      new Set(['AutoDrafts', 'Issue', 'Comments', 'History']),
    )
    for (const body of bodies) expect(body.query).not.toMatch(/mutation/i)
  })
})
