import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

import {
  worktreeClaude,
  stripTimestamps,
  shellFunctionBody,
  runHarness,
  runHarnessEnv,
} from './orchestrator-test-harness'

// The orchestrator keeps its own checkout current (HON-861, HON-1427): it
// fetches origin/main into a ref of its own, fast-forwards the checkout when
// that is safe, and warns when it is not. Split from orchestrator.loop.test.ts.
describe('keep the main checkout current (HON-861, HON-1427)', () => {
  const roots: string[] = []
  afterAll(() => {
    for (const root of roots) fs.rmSync(root, { recursive: true, force: true })
  })

  const gitEnv: Record<string, string> = {
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_SYSTEM: '/dev/null',
    GIT_AUTHOR_NAME: 'harness',
    GIT_AUTHOR_EMAIL: 'harness@example.test',
    GIT_COMMITTER_NAME: 'harness',
    GIT_COMMITTER_EMAIL: 'harness@example.test',
  }
  const git = (cwd: string, ...args: string[]) =>
    execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      env: { ...process.env, ...gitEnv },
      timeout: 30_000,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim()

  const commit = (repo: string, file: string) => {
    fs.mkdirSync(path.dirname(path.join(repo, file)), { recursive: true })
    fs.appendFileSync(path.join(repo, file), `${Date.now()}-${Math.random()}\n`)
    git(repo, 'add', file)
    git(repo, 'commit', '-qm', `touch ${file}`)
  }

  /**
   * A non-bare origin (commits land in it directly, no push) and a clone of
   * it standing in for the main checkout the orchestrator runs from.
   * `between` is shell run before every poll after the first, with the poll
   * number in $1 and ORIGIN / CLONE set.
   */
  function makeFixture(
    ahead: { scripts?: number; other?: number; otherScripts?: number } = {},
    between: string[] = [],
  ) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hon861-checkout-'))
    roots.push(root)
    const origin = path.join(root, 'origin')
    const clone = path.join(root, 'clone')
    git(root, 'init', '-q', '-b', 'main', origin)
    commit(origin, 'scripts/orchestrator.sh')
    git(root, 'clone', '-q', origin, clone)
    for (let i = 0; i < (ahead.scripts ?? 0); i++) commit(origin, 'scripts/orchestrator.sh')
    for (let i = 0; i < (ahead.other ?? 0); i++) commit(origin, 'docs/README.md')
    for (let i = 0; i < (ahead.otherScripts ?? 0); i++) commit(origin, 'scripts/pr-review.sh')
    const script = path.join(root, 'between.sh')
    fs.writeFileSync(
      script,
      [`ORIGIN='${origin}'`, `CLONE='${clone}'`, ...between, 'exit 0'].join('\n'),
    )
    return { origin, clone, between: between.length > 0 ? script : '' }
  }

  // Poll 2 lands one more scripts/ commit on origin.
  const ORIGIN_MOVES_AT_POLL_2 = [
    `if [ "$1" = 2 ]; then`,
    `  cd "$ORIGIN" && echo "poll 2 $RANDOM" >> scripts/orchestrator.sh`,
    `  git add scripts/orchestrator.sh && git commit -qm 'poll 2'`,
    `fi`,
  ]

  const check = (clone: string, polls: number, env: Record<string, string> = {}, between = '') =>
    stripTimestamps(
      runHarnessEnv({ ...gitEnv, ...env }, 'checkout-behind', clone, String(polls), between),
    )
  const polls = (out: string) =>
    [...out.matchAll(/^POLL:\d+:(.*)$/gm)].map(
      (m) => JSON.parse(m[1] ?? 'null') as Record<string, unknown> | null,
    )
  const warns = (out: string) => out.match(/WARN +Checkout is behind origin\/main/g) ?? []
  const pulls = (out: string) => out.match(/INFO +Fast-forwarded the checkout/g) ?? []
  // A branch other than main stops the pull, so the WARN path is under test.
  const onSide = (clone: string) => git(clone, 'checkout', '-q', '-b', 'side')
  const head = (repo: string) => git(repo, 'rev-parse', 'HEAD')

  it('reports commits to the code the checkout runs, once per origin/main SHA', () => {
    const { origin, clone } = makeFixture({ scripts: 1, other: 1 })
    onSide(clone)
    const out = check(clone, 3)
    const [first, ...rest] = polls(out)

    expect(first).toMatchObject({
      behind: 2,
      behind_code: 1,
      origin_main: git(origin, 'rev-parse', 'HEAD').slice(0, 8),
    })
    for (const later of rest) expect(later).toMatchObject({ behind: 2, behind_code: 1 })
    expect(warns(out)).toHaveLength(1)
    expect(out).toContain('by 2 commit(s), 1 changing orchestrator.sh or worktree-claude.sh')
  })

  it('counts worktree-claude.sh, which every worker is spawned through', () => {
    const { clone, origin } = makeFixture()
    onSide(clone)
    commit(origin, 'scripts/worktree-claude.sh')

    expect(polls(check(clone, 1))).toEqual([expect.objectContaining({ behind: 1, behind_code: 1 })])
  })

  it('warns on a commit that changes only worktree-auto-run.sh, which worktree-claude.sh sources (HON-1416)', () => {
    const { clone, origin } = makeFixture()
    onSide(clone)
    commit(origin, 'scripts/worktree-auto-run.sh')
    const out = check(clone, 1)

    expect(polls(out)).toEqual([expect.objectContaining({ behind: 1, behind_code: 1 })])
    expect(warns(out)).toHaveLength(1)
  })

  it('warns again when origin/main moves to a new SHA', () => {
    const { clone, between } = makeFixture({ scripts: 1 }, ORIGIN_MOVES_AT_POLL_2)
    onSide(clone)
    const out = check(clone, 3, {}, between)

    expect(polls(out).map((p) => p?.behind_code)).toEqual([1, 2, 2])
    expect(warns(out)).toHaveLength(2)
  })

  it('fast-forwards a clean main checkout, and leaves the refs workers fetch untouched (HON-1427)', () => {
    const { origin, clone } = makeFixture({ scripts: 2, other: 1 })
    const originMain = git(clone, 'rev-parse', 'refs/remotes/origin/main')

    const out = check(clone, 2)

    expect(head(clone)).toBe(head(origin))
    expect(git(clone, 'status', '--porcelain')).toBe('')
    expect(out).toContain(
      `INFO  Fast-forwarded the checkout to ${head(origin).slice(0, 8)} (3 commit(s), 2 to orchestrator code)`,
    )
    expect(pulls(out)).toHaveLength(1)
    // Pulled on poll 1, so the status file never shows it behind.
    expect(polls(out)).toEqual([null, null])
    expect(warns(out)).toHaveLength(0)
    // Workers fetch refs/remotes/origin/main into the same .git; a second
    // writer of that ref is a lock fight. The check writes its own ref.
    expect(git(clone, 'rev-parse', 'refs/remotes/origin/main')).toBe(originMain)
    expect(git(clone, 'rev-parse', 'refs/orchestrator/origin-main')).not.toBe(originMain)
    expect(fs.existsSync(path.join(clone, '.git', 'FETCH_HEAD'))).toBe(false)
  })

  it('checks while workers run, so a busy queue cannot hide it', () => {
    const { clone } = makeFixture({ scripts: 1 })
    onSide(clone)
    const out = check(clone, 1, { HARNESS_CHECKOUT_WORKER: '1' })

    expect(polls(out)).toEqual([expect.objectContaining({ behind_code: 1 })])
    expect(warns(out)).toHaveLength(1)
  })

  it.each([
    ['up to date', {}],
    ['behind only outside scripts/', { other: 2 }],
    // Workers run every other script from their own fresh worktree.
    ['behind only on scripts the checkout does not run', { otherScripts: 2 }],
  ])('stays silent when the checkout is %s', (_label, ahead) => {
    const { clone } = makeFixture(ahead)
    const out = check(clone, 2)

    expect(polls(out)).toEqual([null, null])
    expect(warns(out)).toHaveLength(0)
  })

  it('does not fetch in a --once run', () => {
    const { clone } = makeFixture({ scripts: 1 })
    const out = check(clone, 1, { HARNESS_CHECKOUT_ONCE: '1' })

    expect(polls(out)).toEqual([null])
    expect(() => git(clone, 'rev-parse', '--verify', 'refs/orchestrator/origin-main')).toThrow()
  })

  it('fetches at most once per interval', () => {
    const { clone, between } = makeFixture({ scripts: 1 }, ORIGIN_MOVES_AT_POLL_2)
    onSide(clone)
    const out = check(clone, 3, { HARNESS_CHECKOUT_INTERVAL: '600' }, between)

    // Poll 2's new commit is not seen: polls 2 and 3 fall inside the interval.
    expect(polls(out).map((p) => p?.behind_code)).toEqual([1, 1, 1])
    expect(warns(out)).toHaveLength(1)
  })

  it('pulls on the next poll after the reason clears, without waiting for a fetch', () => {
    const { origin, clone, between } = makeFixture({ scripts: 1 }, [
      `if [ "$1" = 2 ]; then git -C "$CLONE" checkout -q main; fi`,
    ])
    onSide(clone)
    const out = check(clone, 2, { HARNESS_CHECKOUT_INTERVAL: '600' }, between)

    expect(polls(out)).toEqual([expect.objectContaining({ behind_code: 1 }), null])
    expect(head(clone)).toBe(head(origin))
  })

  it('pulls a checkout that is behind only on docs, without a WARN', () => {
    const { origin, clone } = makeFixture({ other: 2 })
    const out = check(clone, 1)

    expect(head(clone)).toBe(head(origin))
    expect(out).toContain('(2 commit(s), 0 to orchestrator code)')
  })

  describe('does not pull, and says why', () => {
    const notPulled = (out: string) => out.match(/Not pulled: ([^\n]*?)\. Clear that/)?.[1]

    it('when a tracked file has changes, naming the file', () => {
      const { clone } = makeFixture({ scripts: 1 })
      const before = head(clone)
      fs.appendFileSync(path.join(clone, 'scripts/orchestrator.sh'), 'local edit\n')
      const out = check(clone, 1)

      expect(head(clone)).toBe(before)
      expect(notPulled(out)).toBe('uncommitted changes in scripts/orchestrator.sh')
    })

    it('when the checkout is on another branch, naming the branch', () => {
      const { clone } = makeFixture({ scripts: 1 })
      const before = head(clone)
      onSide(clone)
      const out = check(clone, 1)

      expect(head(clone)).toBe(before)
      expect(git(clone, 'branch', '--show-current')).toBe('side')
      expect(notPulled(out)).toBe('the checkout is on branch side')
      expect(polls(out)).toEqual([
        expect.objectContaining({ not_pulled: 'the checkout is on branch side' }),
      ])
    })

    it('records the new reason when it changes, and drops it once pulled (HON-1428)', () => {
      const { origin, clone, between } = makeFixture({ scripts: 1 }, [
        `if [ "$1" = 2 ]; then git -C "$CLONE" checkout -q main && git -C "$CLONE" -c user.name=t -c user.email=t@t commit -q --allow-empty -m local; fi`,
        `if [ "$1" = 3 ]; then git -C "$CLONE" reset -q --hard HEAD~1; fi`,
      ])
      onSide(clone)
      const out = check(clone, 3, {}, between)

      expect(polls(out)).toEqual([
        expect.objectContaining({ not_pulled: 'the checkout is on branch side' }),
        expect.objectContaining({ not_pulled: '1 local commit' }),
        null,
      ])
      expect(head(clone)).toBe(head(origin))
    })

    it('when main has a local commit', () => {
      const { clone } = makeFixture({ scripts: 1 })
      commit(clone, 'notes.md')
      const before = head(clone)
      const out = check(clone, 1)

      expect(head(clone)).toBe(before)
      expect(notPulled(out)).toBe('1 local commit')
    })

    it('when a merge is in progress', () => {
      const { clone } = makeFixture({ scripts: 1 })
      const before = head(clone)
      fs.writeFileSync(path.join(clone, '.git', 'MERGE_HEAD'), `${before}\n`)
      const out = check(clone, 1)

      expect(head(clone)).toBe(before)
      expect(notPulled(out)).toBe('a merge is in progress')
    })

    it('when the merge would overwrite an untracked file, quoting git', () => {
      const { clone, origin } = makeFixture()
      commit(origin, 'scripts/worktree-claude.sh')
      const before = head(clone)
      fs.mkdirSync(path.join(clone, 'scripts'), { recursive: true })
      fs.writeFileSync(path.join(clone, 'scripts/worktree-claude.sh'), 'untracked\n')
      const out = check(clone, 1)

      expect(head(clone)).toBe(before)
      expect(notPulled(out)).toMatch(/^git merge --ff-only failed: error: .*untracked/)
      expect(pulls(out)).toHaveLength(0)
    })
  })

  it.each([
    ['fetches and pulls on the next poll', '2', true],
    ['waits for the interval', '', false],
  ])('after a SUCCESS outcome, %s (HON-1427)', (_label, successAt, current) => {
    const { origin, clone, between } = makeFixture({ scripts: 1 }, ORIGIN_MOVES_AT_POLL_2)
    const out = check(
      clone,
      2,
      { HARNESS_CHECKOUT_INTERVAL: '600', HARNESS_CHECKOUT_SUCCESS_AT: successAt },
      between,
    )

    expect(head(clone) === head(origin)).toBe(current)
    expect(pulls(out)).toHaveLength(current ? 2 : 1)
  })

  describe('checkout_behind_notice', () => {
    const notice = (status: unknown) =>
      runHarness('checkout-notice', JSON.stringify(status)).trim().slice(1, -1)

    it('says how far behind, and what to do', () => {
      expect(
        notice({
          checkout: { behind: 3, behind_code: 2, origin_main: 'abcd1234', checked_at: 'x' },
        }),
      ).toBe(
        'Checkout is 3 commit(s) behind origin/main (abcd1234), 2 changing orchestrator.sh or worktree-claude.sh: pull it, and the orchestrator reloads itself on its next poll',
      )
    })

    it('names the reason the orchestrator did not pull it (HON-1428)', () => {
      expect(
        notice({
          checkout: {
            behind: 3,
            behind_code: 2,
            origin_main: 'abcd1234',
            checked_at: 'x',
            not_pulled: 'the checkout is on branch side',
          },
        }),
      ).toBe(
        'Checkout is 3 commit(s) behind origin/main (abcd1234), 2 changing orchestrator.sh or worktree-claude.sh, not pulled: the checkout is on branch side. Clear that, and the orchestrator pulls it on its next poll',
      )
    })

    it.each([
      ['a current checkout', { checkout: null }],
      ['a status file from before HON-861', { pid: 1 }],
      ['no commits to the code the checkout runs', { checkout: { behind: 4, behind_code: 0 } }],
    ])('is empty for %s', (_label, status) => {
      expect(notice(status)).toBe('')
    })

    it.each(['cmd_status', 'cmd_watch'])('is what %s renders', (fn) => {
      expect(shellFunctionBody(fs.readFileSync(worktreeClaude, 'utf8'), fn)).toContain(
        'checkout_behind_notice "$status"',
      )
    })
  })
})
