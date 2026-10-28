/**
 * The CI-settle gate that decides when a PR may be merged (HON-600).
 *
 * The poll has two implementations that must agree: `pr_ci_state()` in
 * orchestrator.sh (covered in orchestrator.phase.test.ts) and scripts/ci-settle.sh,
 * which /auto-implement Phase 6.5 (re-run by 7.2) and /merge Step 2 call. Each skill
 * also carries a one-line verification that reads the settled state. The poll used
 * to be a bash block in the skill markdown, and this file extracted it to run it;
 * HON-1190 moved it into the script, so the test executes the script and checks
 * that no skill carries a copy of the loop.
 *
 * On 2026-09-01 the gate cost three runs. Vercel's commit status stuck at
 * "deploying your app" long after the deployment was Ready — 9 h on PR #678,
 * ~1h45m on #676 — and the loop's "none pending" rule could not settle, so
 * each worker burned its poll budget and left a fully green PR unmerged. The
 * fix exempts a *pending* third-party commit status (`gh pr checks --json
 * workflow` returns "" for those, and a workflow name for every Actions job);
 * a failing one still blocks, because ci.yml runs no `next build` and Vercel
 * is therefore the only build gate.
 *
 * Lives in scripts/ next to orchestrator.phase.test.ts, which tests the other
 * implementation of the same rule.
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const autoImplementSkill = path.join(repoRoot, '.claude/skills/auto-implement')
const mergeSkill = path.join(repoRoot, '.claude/skills/merge')
const triageSkill = path.join(repoRoot, '.claude/skills/triage-pr-comments')
const ciSettle = path.join(repoRoot, 'scripts/ci-settle.sh')
const orchestrator = path.join(repoRoot, 'scripts/orchestrator.sh')

/** The filter every site must carry, verbatim. */
const EXEMPTION = 'select(.workflow != "" or .bucket != "pending")'

const read = (file: string) => fs.readFileSync(file, 'utf8')
/**
 * A skill's whole text: SKILL.md plus the sibling files it reads on demand.
 * /auto-implement keeps its rarely-taken branches in siblings (HON-787) — the
 * "no checks reported" classifier lives in recovery.md — so a site is counted
 * wherever in the skill it lives.
 */
const readSkill = (dir: string) =>
  fs
    .readdirSync(dir)
    .filter((file) => file.endsWith('.md'))
    .sort()
    .map((file) => read(path.join(dir, file)))
    .join('\n')
const countOccurrences = (haystack: string, needle: string) => haystack.split(needle).length - 1

/** Every ```bash fenced block in a markdown file, fence lines excluded. */
function bashBlocks(markdown: string): string[] {
  return [...markdown.matchAll(/^```bash\n([\s\S]*?)^```$/gm)].map((m) => m[1] ?? '')
}

/** The text with every quoted heredoc body (`<<'EOF'` … `EOF`) removed: it is data, not shell. */
function stripHeredocs(text: string): string {
  return text.replace(/<<'(\w+)'\n[\s\S]*?^\s*\1$/gm, "<<'$1'")
}

/** The body of `pr_ci_state()` in orchestrator.sh, up to its closing brace. */
function prCiState(): string {
  const source = read(orchestrator)
  const start = source.indexOf('pr_ci_state() {')
  if (start === -1) throw new Error('pr_ci_state() not found in orchestrator.sh')
  return source.slice(start, source.indexOf('\n}\n', start))
}

type Check = { name: string; bucket: string; workflow: string }

/** A GitHub Actions job — always reports a non-empty `workflow`. */
const job = (name: string, bucket: string, workflow = 'CI'): Check => ({ name, bucket, workflow })
/** A commit status posted by a third-party app, e.g. Vercel's deploy. */
const commitStatus = (bucket: string): Check => ({ name: 'Vercel', bucket, workflow: '' })

/** The ci.yml job the loop refuses to settle without, on every PR (HON-1184). */
const CI_JOB = 'Lint, Type Check & Test'

describe('CI-settle gate', () => {
  describe('exemption is present at every site', () => {
    // The two polls must filter identically, byte for byte. orchestrator.sh is
    // not edited to share the script: pr_ci_state() is a one-shot state read, and
    // a change there reloads the running orchestrator (HON-1190).
    it('appears verbatim in ci-settle.sh and in pr_ci_state()', () => {
      expect(countOccurrences(read(ciSettle), EXEMPTION)).toBe(1)
      expect(prCiState()).toContain(EXEMPTION)
    })

    // Each skill keeps one runnable line that reads the settled state: the 6.5
    // verification (which 7.2 re-runs) and /merge Step 2's. A site that misses the
    // filter is a site that strands PRs.
    it('appears once in /auto-implement and once in /merge, in the verification', () => {
      expect(countOccurrences(readSkill(autoImplementSkill), EXEMPTION)).toBe(1)
      expect(countOccurrences(readSkill(mergeSkill), EXEMPTION)).toBe(1)
    })

    // Prose is excluded on purpose — only runnable lines can strand a PR.
    it('leaves no unfiltered `gh pr checks` call in any shell block or in the script', () => {
      const sources = [
        ...[autoImplementSkill, mergeSkill].map((dir) => ({
          name: path.basename(dir),
          lines: bashBlocks(readSkill(dir)).flatMap((block) => block.split('\n')),
        })),
        { name: 'ci-settle.sh', lines: read(ciSettle).split('\n') },
      ]
      for (const { name, lines } of sources) {
        const calls = lines
          .filter((line) => !line.trimStart().startsWith('#'))
          .filter((line) => line.includes('gh pr checks'))

        expect(calls.length, `${name} has no gh pr checks`).toBeGreaterThan(0)
        for (const line of calls) {
          // The `gh` line names the fields; a local `jq` applies the filter.
          // Assert on the fields here.
          expect(line, `${name}: ${line.trim()}`).toContain('workflow')
        }
      }
    })

    // HON-1184: no PR is exempt from the required check. The polls used to
    // classify a PR as docs-only from its file list and settle such a PR without
    // the ci.yml job, because ci.yml skipped docs paths. HON-584 removed that
    // path filter and made the job a required status check, so a docs-only PR
    // that settled before its run registered went straight into a merge GitHub
    // refuses. With the classifier gone, nothing reads the file list, so the
    // fetch goes too: no file-list call may remain in a runnable line.
    it('classifies no PR as docs-only and reads no file list', () => {
      const sources = [
        ...[autoImplementSkill, mergeSkill].map((dir) => ({
          name: path.basename(dir),
          source: readSkill(dir),
          lines: bashBlocks(readSkill(dir)).flatMap((block) => block.split('\n')),
        })),
        { name: 'ci-settle.sh', source: read(ciSettle), lines: read(ciSettle).split('\n') },
      ]
      for (const { name, source, lines } of sources) {
        expect(countOccurrences(source, 'DOCS_ONLY'), name).toBe(0)
        expect(countOccurrences(source, 'NON_DOCS'), name).toBe(0)

        const fileReads = lines
          .filter((line) => !line.trimStart().startsWith('#'))
          .filter((line) => line.includes('/files') || line.includes('changedFiles'))
        expect(fileReads, `${name}: ${fileReads.join(' / ')}`).toEqual([])
      }
    })

    // The rule that replaced it: the ci.yml job row, unconditionally, once in the
    // poll. A guard in front of it (`[ … ] ||`) would bring an exemption back.
    it('requires the ci.yml job on every PR in the poll', () => {
      expect(
        countOccurrences(
          read(ciSettle),
          `  printf '%s\\n' "$CUR" | grep -q '^Lint, Type Check' || OK=0`,
        ),
      ).toBe(1)
    })
  })

  // HON-1190: the poll is a script, and a skill only calls it. A copy of the loop
  // in prose drifts from the tested one, which is how the two sites came to need
  // a byte-identity test in the first place.
  describe('skills call the script', () => {
    const section = (file: string, from: string, to: string) => {
      const text = read(file)
      const start = text.indexOf(from)
      const end = text.indexOf(to, start + from.length)
      expect(start, `${from} in ${path.basename(file)}`).toBeGreaterThan(-1)
      expect(end, `${to} in ${path.basename(file)}`).toBeGreaterThan(start)
      return text.slice(start, end)
    }

    it('calls scripts/ci-settle.sh from /auto-implement 6.5 and /merge Step 2', () => {
      const waits = [
        section(path.join(autoImplementSkill, 'SKILL.md'), '### 6.5 Wait for CI', '### 6.6'),
        section(path.join(mergeSkill, 'SKILL.md'), '### Step 2: Wait for CI', '### Step 2.5'),
      ]
      for (const wait of waits) {
        expect(bashBlocks(wait).filter((b) => b.includes('scripts/ci-settle.sh'))).toHaveLength(1)
      }
    })

    // 7.2 re-runs 6.5 by reference rather than carrying its own copy (HON-787).
    it('has /auto-implement 7.2 re-run 6.5', () => {
      const merge = section(
        path.join(autoImplementSkill, 'SKILL.md'),
        '### 7.2 Wait for CI',
        '### 7.3',
      )
      expect(merge).toContain('Re-run the 6.5 poll')
      expect(merge).toContain('6.5 verification block')
    })

    // A poll is a sleep, a counter or a printed marker. The markers may still be
    // named in prose, which is how a skill tells its reader what to act on.
    it('leaves no poll in any bash block of either skill', () => {
      for (const dir of [autoImplementSkill, mergeSkill]) {
        const polls = bashBlocks(readSkill(dir)).filter((block) =>
          /\bsleep\b|\bseq\b|echo "?CI_|ci-poll-/.test(block),
        )
        expect(polls, path.basename(dir)).toEqual([])
      }
    })

    // The acceptance criterion: logic with control flow lives in a script with a
    // test. English in a comment or in a PR-body heredoc is not control flow, so
    // the check reads shell keywords in command position.
    it('leaves no shell control flow in the three skills that fetch PR state', () => {
      for (const dir of [autoImplementSkill, mergeSkill, triageSkill]) {
        const lines = bashBlocks(stripHeredocs(read(path.join(dir, 'SKILL.md'))))
          .flatMap((block) => block.split('\n'))
          .filter((line) => !line.trimStart().startsWith('#'))
          .filter(
            (line) =>
              /(^|[;&|(]\s*)(for|while|until|if|case)\s/.test(line.trimStart()) ||
              /(^|;\s*|\s)(then|do|done|fi|esac)\s*(;|$)/.test(line),
          )
        expect(lines, path.basename(dir)).toEqual([])
      }
    })
  })

  // The poll itself, executed. `gh` and `sleep` are stubbed on PATH: `gh`
  // replays a fixture that the script's own jq expression then filters (so the
  // jq is what is under test), and `sleep` is a no-op (so 16 polls × 30 s runs
  // instantly). `gh pr view` prints nothing, so the head check never matches and
  // every case here runs the two-poll rule; ci-settle-head.test.ts covers the rest.
  describe('scripts/ci-settle.sh', () => {
    let stubBin: string
    let callLog: string
    // The script keys its chunk/prev state on the PR number under /tmp, so every
    // run needs a fresh one. The base is far above any real PR number, so a
    // test can never reap or inherit the state of a live poll on this machine.
    let prNumber = 990000

    beforeAll(() => {
      stubBin = fs.mkdtempSync(path.join(os.tmpdir(), 'hon600-bin-'))
      callLog = path.join(stubBin, 'checks-calls')

      // Prints $STUB_CHECKS through the caller's --jq, if any, as gh would, and
      // records each `pr checks` call so a test can assert which poll settled.
      fs.writeFileSync(
        path.join(stubBin, 'gh'),
        [
          '#!/bin/sh',
          'case "$2" in',
          '  checks)',
          `    echo call >> ${JSON.stringify(callLog)}`,
          '    jq_expr=""',
          '    while [ $# -gt 0 ]; do [ "$1" = "--jq" ] && jq_expr="$2"; shift; done',
          '    printf \'%s\' "$STUB_CHECKS" | jq -r "${jq_expr:-.}"',
          '    ;;',
          'esac',
          '',
        ].join('\n'),
        { mode: 0o755 },
      )
      fs.writeFileSync(path.join(stubBin, 'sleep'), '#!/bin/sh\nexit 0\n', { mode: 0o755 })
    })

    afterAll(() => fs.rmSync(stubBin, { recursive: true, force: true }))

    afterEach(() => {
      fs.rmSync(`/tmp/ci-poll-${prNumber}.prev`, { force: true })
      fs.rmSync(`/tmp/ci-poll-${prNumber}.chunks`, { force: true })
    })

    /**
     * Run the script once against the current PR number, keeping its state
     * files. Returns its marker, its whole stdout, its exit code and the poll count.
     */
    function invoke(checks: Check[], args: string[] = [String(prNumber)]) {
      fs.rmSync(callLog, { force: true })

      let out: string
      let status = 0
      try {
        out = execFileSync('bash', [ciSettle, ...args], {
          encoding: 'utf8',
          timeout: 60_000,
          stdio: ['ignore', 'pipe', 'pipe'],
          env: {
            ...process.env,
            PATH: `${stubBin}:${process.env.PATH}`,
            STUB_CHECKS: JSON.stringify(checks),
          },
        })
      } catch (error) {
        // CI_TIMEOUT exits 1; its marker is still on stdout.
        const failure = error as { stdout?: string; status?: number }
        out = String(failure.stdout ?? '')
        status = failure.status ?? -1
      }
      const polls = fs.existsSync(callLog)
        ? fs.readFileSync(callLog, 'utf8').trim().split('\n').length
        : 0
      return { marker: out.trim().split('\n').pop() ?? '', out, status, polls }
    }

    /**
     * Run one chunk on a fresh PR number, so no earlier test's state carries over.
     *
     * The stub serves no file list: the script must decide from the check list
     * alone, so a docs-only PR and a code PR with the same checks look the same.
     */
    function runChunk(checks: Check[]) {
      prNumber += 1
      fs.rmSync(`/tmp/ci-poll-${prNumber}.prev`, { force: true })
      fs.rmSync(`/tmp/ci-poll-${prNumber}.chunks`, { force: true })
      return invoke(checks)
    }

    // The HON-589 scenario, verbatim: GitHub Actions fully green, Vercel's
    // status pending forever. Before the exemption this ran out the 6-chunk
    // budget and reported CI_TIMEOUT on a mergeable PR.
    it('settles on the second poll with Actions green and a stuck Vercel status', () => {
      const { marker, polls } = runChunk([
        job(CI_JOB, 'pass'),
        job('Vercel env-var drift audit', 'pass'),
        job('Smoke tests on Vercel preview', 'skipping', 'Preview smoke'),
        commitStatus('pending'),
      ])

      expect(marker).toBe('CI_SETTLED')
      expect(polls).toBe(2)
    })

    it('settles when everything including Vercel has reported pass', () => {
      const { marker, polls } = runChunk([job(CI_JOB, 'pass'), commitStatus('pass')])

      expect(marker).toBe('CI_SETTLED')
      expect(polls).toBe(2)
    })

    // The exemption is pending-only. ci.yml runs no `next build`, so a failed
    // Vercel deploy is the only signal that the app does not compile — it must
    // reach the verification step, which means the loop must still settle on it.
    it('settles on a failed Vercel status so the verification can block the merge', () => {
      const { marker } = runChunk([job(CI_JOB, 'pass'), commitStatus('fail')])

      expect(marker).toBe('CI_SETTLED')
    })

    it('keeps waiting while an Actions job is pending', () => {
      const { marker } = runChunk([job(CI_JOB, 'pending'), commitStatus('pending')])

      expect(marker).toBe('CI_WAITING (chunk 1/6)')
    })

    it('keeps waiting until the ci.yml job registers', () => {
      const { marker } = runChunk([job('Vercel env-var drift audit', 'pass'), commitStatus('pass')])

      expect(marker).toBe('CI_WAITING (chunk 1/6)')
    })

    // HON-1184. A docs-only PR before its ci.yml run registers: Preview smoke
    // is `on: deployment_status` gated on `state == 'success'`, so it never
    // registers while Vercel is pending, and the pending Vercel row is exempted
    // away. The list is empty, and it stays empty across two polls. The loop
    // used to settle here for a docs-only PR, because ci.yml skipped docs paths;
    // since HON-584 the job runs on every PR and is a required check, so
    // settling here sends the PR into a merge GitHub refuses.
    it('keeps waiting on a docs-only PR that has no ci.yml job row yet', () => {
      const { marker } = runChunk([commitStatus('pending')])

      expect(marker).toBe('CI_WAITING (chunk 1/6)')
    })

    // The same docs-only PR once the required job has reported: it settles like
    // any other, with Vercel still stuck.
    it('settles a docs-only PR once the ci.yml job row is pass', () => {
      const { marker, polls } = runChunk([job(CI_JOB, 'pass'), commitStatus('pending')])

      expect(marker).toBe('CI_SETTLED')
      expect(polls).toBe(2)
    })

    // The caller reads the last line, so nothing may follow the marker, and the
    // exit codes are the ones the skill block used: 0 for SETTLED and WAITING.
    it('prints only the marker and exits 0 on CI_SETTLED and CI_WAITING', () => {
      const settled = runChunk([job(CI_JOB, 'pass')])
      expect(settled.out).toBe('CI_SETTLED\n')
      expect(settled.status).toBe(0)

      const waiting = runChunk([job(CI_JOB, 'pending')])
      expect(waiting.out).toBe('CI_WAITING (chunk 1/6)\n')
      expect(waiting.status).toBe(0)
    })

    // Each invocation is one chunk; the count lives in /tmp keyed on the PR, so
    // the sixth chunk of one episode times out with exit 1 and clears its state.
    // Six script runs outlast the 10 s default on a loaded machine (HON-1295).
    it('counts chunks across invocations and times out on the sixth with exit 1', () => {
      const pending = [job(CI_JOB, 'pending')]
      const markers = [runChunk(pending).marker]
      for (let chunk = 2; chunk <= 5; chunk++) markers.push(invoke(pending).marker)
      const last = invoke(pending)

      expect(markers).toEqual([1, 2, 3, 4, 5].map((n) => `CI_WAITING (chunk ${n}/6)`))
      expect(last.out).toBe('CI_TIMEOUT\n')
      expect(last.status).toBe(1)
      expect(fs.existsSync(`/tmp/ci-poll-${prNumber}.chunks`)).toBe(false)
    }, 60_000)

    // The previous poll's list carries over between chunks: a chunk whose last
    // poll saw the final list settles on the next chunk's first poll, while a
    // first chunk never settles on one poll (the INIT sentinel).
    it('carries the previous poll across chunks', () => {
      runChunk([job(CI_JOB, 'pending')])
      fs.writeFileSync(`/tmp/ci-poll-${prNumber}.prev`, `${CI_JOB}=pass`)
      const next = invoke([job(CI_JOB, 'pass')])

      expect(next.marker).toBe('CI_SETTLED')
      expect(next.polls).toBe(1)
    })

    it('exits 2 with no marker when the PR number is missing', () => {
      const { out, status, polls } = invoke([], [])

      expect(out).toBe('')
      expect(status).toBe(2)
      expect(polls).toBe(0)
    })
  })
})
