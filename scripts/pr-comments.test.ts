/**
 * Drives `scripts/pr-comments.sh` with `gh` replaced by a stub on PATH that
 * serves the two-page stream `gh api --paginate` prints (HON-1190). `jq` is the
 * real one, so the slurp, the `add // error` guard and the `--head` filter are
 * what is under test.
 *
 * The fetch used to be copied into every skill that reads PR comments, each copy
 * with its own jq and its own comment on why `--jq` must not be used (HON-586).
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const prComments = path.join(path.dirname(fileURLToPath(import.meta.url)), 'pr-comments.sh')

const HEAD = 'a1b2c3d'
const OLD = '9f8e7d6'

/** A raw GitHub record, with fields the script must drop. */
const record = (id: number, commit: string) => ({
  id,
  body: `**Finding ${id}**`,
  path: 'src/a.ts',
  line: id,
  original_line: id,
  diff_hunk: '@@ -1 +1 @@',
  commit_id: commit,
  original_commit_id: commit,
  user: { login: 'henri', id: 1, avatar_url: 'https://example.com/a.png' },
  in_reply_to_id: null,
  created_at: '2026-10-14T00:00:00Z',
  html_url: `https://github.com/x/y/pull/1#discussion_r${id}`,
})

/** What `gh api --paginate` prints: one JSON array per page, back to back. */
const TWO_PAGES = `${JSON.stringify([record(1, OLD), record(2, OLD)])}${JSON.stringify([record(3, HEAD)])}`

describe('scripts/pr-comments.sh', () => {
  let stubBin: string
  let argLog: string

  beforeAll(() => {
    stubBin = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-comments-bin-'))
    argLog = path.join(stubBin, 'gh-args')
    // Records its arguments, prints $STUB_PAGES, exits $STUB_EXIT.
    fs.writeFileSync(
      path.join(stubBin, 'gh'),
      [
        '#!/bin/sh',
        `printf '%s\\n' "$*" >> ${JSON.stringify(argLog)}`,
        'printf \'%s\' "$STUB_PAGES"',
        'exit "${STUB_EXIT:-0}"',
        '',
      ].join('\n'),
      { mode: 0o755 },
    )
  })

  afterAll(() => fs.rmSync(stubBin, { recursive: true, force: true }))

  function run(args: string[], pages = TWO_PAGES, exitCode = 0) {
    fs.rmSync(argLog, { force: true })
    const result = spawnSync('bash', [prComments, ...args], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${stubBin}:${process.env.PATH}`,
        STUB_PAGES: pages,
        STUB_EXIT: String(exitCode),
      },
    })
    const ghCalls = fs.existsSync(argLog) ? fs.readFileSync(argLog, 'utf8').trim().split('\n') : []
    return { ...result, ghCalls }
  }

  it('prints one array holding both pages, in order', () => {
    const { status, stdout } = run(['42', 'inline'])

    expect(status).toBe(0)
    expect(JSON.parse(stdout).map((c: { id: number }) => c.id)).toEqual([1, 2, 3])
  })

  it('keeps the fields the skills read and drops the rest', () => {
    const [first] = JSON.parse(run(['42', 'inline']).stdout)

    expect(first).toEqual({
      id: 1,
      body: '**Finding 1**',
      path: 'src/a.ts',
      line: 1,
      original_line: 1,
      diff_hunk: '@@ -1 +1 @@',
      commit_id: OLD,
      user: { login: 'henri' },
      in_reply_to_id: null,
      state: null,
      created_at: '2026-10-14T00:00:00Z',
      submitted_at: null,
    })
  })

  it.each([
    ['inline', '/repos/:owner/:repo/pulls/42/comments?per_page=100'],
    ['reviews', '/repos/:owner/:repo/pulls/42/reviews?per_page=100'],
    ['issue', '/repos/:owner/:repo/issues/42/comments?per_page=100'],
  ])('fetches %s from its endpoint, paginated', (kind, endpoint) => {
    const { status, ghCalls } = run(['42', kind])

    expect(status).toBe(0)
    expect(ghCalls).toEqual([`api --paginate ${endpoint}`])
  })

  it('keeps only the records on the --head commit', () => {
    const { status, stdout } = run(['42', 'inline', '--head', HEAD])

    expect(status).toBe(0)
    expect(JSON.parse(stdout).map((c: { id: number }) => c.id)).toEqual([3])
  })

  it('prints [] and exits 0 for a PR with no comments', () => {
    const { status, stdout } = run(['42', 'issue'], '[]')

    expect(status).toBe(0)
    expect(JSON.parse(stdout)).toEqual([])
  })

  // HON-586: bare `add` over an empty slurp prints `null` and exits 0, which a
  // caller reads as "no comments". The fetch that produced nothing must fail.
  it('fails with a message on stderr when the fetch produced no output', () => {
    const { status, stdout, stderr } = run(['42', 'issue'], '')

    expect(status).not.toBe(0)
    expect(stdout).toBe('')
    expect(stderr).toContain('the fetch produced no output')
  })

  // A page-2 failure leaves page 1 on gh's stdout; printing it would pass a
  // partial list off as the whole.
  it('prints nothing when gh fails after a page', () => {
    const { status, stdout, stderr } = run(['42', 'inline'], JSON.stringify([record(1, OLD)]), 1)

    expect(status).toBe(1)
    expect(stdout).toBe('')
    expect(stderr).toContain('gh api failed')
  })

  it.each([
    [[]],
    [['42']],
    [['42', 'files']],
    [['abc', 'inline']],
    [['42', 'inline', '--head']],
    [['42', 'issue', '--head', HEAD]],
  ])('exits 2 without calling gh on bad arguments: %j', (args) => {
    const { status, stdout, ghCalls } = run(args)

    expect(status).toBe(2)
    expect(stdout).toBe('')
    expect(ghCalls).toEqual([])
  })
})
