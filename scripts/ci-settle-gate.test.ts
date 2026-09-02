/**
 * The CI-settle gate that decides when a PR may be merged (HON-600).
 *
 * The gate has three implementations that must agree: `pr_ci_state()` in
 * orchestrator.sh (covered in orchestrator.test.ts) and two shell snippets
 * embedded in skill markdown — /auto-implement Phase 6.1 and 7.2, and /merge
 * Step 2. The markdown ones are the ones that actually merge PRs, and until
 * this file existed nothing executed them: the snippets were prose, and every
 * defect in them had to be found by stranding a real PR.
 *
 * On 2026-09-01 that cost three runs. Vercel's commit status stuck at
 * "deploying your app" long after the deployment was Ready — 9 h on PR #678,
 * ~1h45m on #676 — and the loop's "none pending" rule could not settle, so
 * each worker burned its poll budget and left a fully green PR unmerged. The
 * fix exempts a *pending* third-party commit status (`gh pr checks --json
 * workflow` returns "" for those, and a workflow name for every Actions job);
 * a failing one still blocks, because ci.yml runs no `next build` and Vercel
 * is therefore the only build gate.
 *
 * Lives in scripts/ rather than .claude/skills/ so it sits next to
 * orchestrator.test.ts, which tests the third implementation of the same rule.
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const autoImplementSkill = path.join(repoRoot, '.claude/skills/auto-implement/SKILL.md')
const mergeSkill = path.join(repoRoot, '.claude/skills/merge/SKILL.md')

/** The filter every site must carry, verbatim. */
const EXEMPTION = 'select(.workflow != "" or .bucket != "pending")'

const read = (file: string) => fs.readFileSync(file, 'utf8')
const countOccurrences = (haystack: string, needle: string) => haystack.split(needle).length - 1

/** Every ```bash fenced block in a markdown file, fence lines excluded. */
function bashBlocks(markdown: string): string[] {
  return [...markdown.matchAll(/^```bash\n([\s\S]*?)^```$/gm)].map((m) => m[1] ?? '')
}

type Check = { name: string; bucket: string; workflow: string }

/** A GitHub Actions job — always reports a non-empty `workflow`. */
const job = (name: string, bucket: string, workflow = 'CI'): Check => ({ name, bucket, workflow })
/** A commit status posted by a third-party app, e.g. Vercel's deploy. */
const commitStatus = (bucket: string): Check => ({ name: 'Vercel', bucket, workflow: '' })

/** The ci.yml job the loop refuses to settle without, for a PR touching code. */
const CI_JOB = 'Lint, Type Check & Test'

describe('CI-settle gate', () => {
  describe('exemption is present at every site', () => {
    // The AC's own grep, as an assertion: four snippets in /auto-implement
    // (6.1 poll + verify, 7.2 poll + verify) and two in /merge (Step 2 poll +
    // verify). A site that misses the filter is a site that strands PRs.
    it('appears four times in /auto-implement and twice in /merge', () => {
      expect(countOccurrences(read(autoImplementSkill), EXEMPTION)).toBe(4)
      expect(countOccurrences(read(mergeSkill), EXEMPTION)).toBe(2)
    })

    // Prose is excluded on purpose — only runnable lines can strand a PR.
    it('leaves no unfiltered `gh pr checks` call in any shell block', () => {
      for (const file of [autoImplementSkill, mergeSkill]) {
        const calls = bashBlocks(read(file))
          .flatMap((block) => block.split('\n'))
          .filter((line) => line.includes('gh pr checks'))

        expect(
          calls.length,
          `${path.basename(path.dirname(file))} has no gh pr checks`,
        ).toBeGreaterThan(0)
        for (const line of calls) {
          // The call is split across two lines: the `gh` line names the fields,
          // the `--jq` line carries the filter. Assert on the fields here.
          expect(line, `${path.basename(path.dirname(file))}: ${line.trim()}`).toContain('workflow')
        }
      }
    })

    it('keeps the two /auto-implement poll loops byte-identical', () => {
      const loops = bashBlocks(read(autoImplementSkill)).filter((b) => b.includes('CI_SETTLED'))

      expect(loops).toHaveLength(2)
      expect(loops[0]).toBe(loops[1])
    })
  })

  // The loop itself, executed. `gh` and `sleep` are stubbed on PATH: `gh`
  // replays a fixture through the caller's own jq expression (so the jq is what
  // is under test), and `sleep` is a no-op (so 16 polls × 30 s runs instantly).
  describe('/auto-implement poll loop', () => {
    let stubBin: string
    let pollScript: string
    let callLog: string
    // The loop keys its chunk/prev state on the PR number under /tmp, so every
    // run needs a fresh one. The base is far above any real PR number, so a
    // test can never reap or inherit the state of a live poll on this machine.
    let prNumber = 990000

    beforeAll(() => {
      stubBin = fs.mkdtempSync(path.join(os.tmpdir(), 'hon600-bin-'))
      callLog = path.join(stubBin, 'checks-calls')

      // Applies the caller's --jq to $STUB_CHECKS exactly as gh would, and
      // records each `pr checks` call so a test can assert which poll settled.
      fs.writeFileSync(
        path.join(stubBin, 'gh'),
        [
          '#!/bin/sh',
          'case "$2" in',
          '  view)',
          '    case "$*" in',
          '      *"--json number"*) printf \'%s\\n\' "$STUB_PR_NUMBER" ;;',
          '      *"--json files"*)  printf \'%s\\n\' "$STUB_FILES" ;;',
          '    esac',
          '    ;;',
          '  checks)',
          `    echo call >> ${JSON.stringify(callLog)}`,
          '    jq_expr=""',
          '    while [ $# -gt 0 ]; do [ "$1" = "--jq" ] && jq_expr="$2"; shift; done',
          '    printf \'%s\' "$STUB_CHECKS" | jq -r "$jq_expr"',
          '    ;;',
          'esac',
          '',
        ].join('\n'),
        { mode: 0o755 },
      )
      fs.writeFileSync(path.join(stubBin, 'sleep'), '#!/bin/sh\nexit 0\n', { mode: 0o755 })

      const [loop] = bashBlocks(read(autoImplementSkill)).filter((b) => b.includes('CI_SETTLED'))
      if (!loop) throw new Error('no CI_SETTLED poll loop found in the skill')
      pollScript = path.join(stubBin, 'poll.sh')
      fs.writeFileSync(pollScript, loop)
    })

    afterAll(() => fs.rmSync(stubBin, { recursive: true, force: true }))

    afterEach(() => {
      fs.rmSync(`/tmp/ci-poll-${prNumber}.prev`, { force: true })
      fs.rmSync(`/tmp/ci-poll-${prNumber}.chunks`, { force: true })
    })

    /** Run one chunk of the loop. Returns its marker and the poll count. */
    function runChunk(checks: Check[], files = 'src/app/page.tsx') {
      prNumber += 1
      fs.rmSync(callLog, { force: true })
      fs.rmSync(`/tmp/ci-poll-${prNumber}.prev`, { force: true })
      fs.rmSync(`/tmp/ci-poll-${prNumber}.chunks`, { force: true })

      let out: string
      try {
        out = execFileSync('bash', [pollScript], {
          encoding: 'utf8',
          timeout: 60_000,
          env: {
            ...process.env,
            PATH: `${stubBin}:${process.env.PATH}`,
            STUB_PR_NUMBER: String(prNumber),
            STUB_FILES: files,
            STUB_CHECKS: JSON.stringify(checks),
          },
        })
      } catch (error) {
        // CI_TIMEOUT exits 1; its marker is still on stdout.
        out = String((error as { stdout?: string }).stdout ?? '')
      }
      const polls = fs.existsSync(callLog)
        ? fs.readFileSync(callLog, 'utf8').trim().split('\n').length
        : 0
      return { marker: out.trim().split('\n').pop() ?? '', polls }
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

    // Exempting the only row that reported leaves an empty list, and the
    // loop's "at least one check exists" rule has to catch that — otherwise a
    // PR whose Actions run never registered would settle green on nothing.
    it('keeps waiting when a pending Vercel status is the only check', () => {
      const { marker } = runChunk([commitStatus('pending')])

      expect(marker).toBe('CI_WAITING (chunk 1/6)')
    })

    it('keeps waiting until the ci.yml job registers for a code PR', () => {
      const { marker } = runChunk([job('Vercel env-var drift audit', 'pass'), commitStatus('pass')])

      expect(marker).toBe('CI_WAITING (chunk 1/6)')
    })

    // A docs-only PR never runs ci.yml, so the "Lint, Type Check & Test" rule
    // is waived — but the Vercel exemption still has to hold, or docs PRs
    // strand the same way.
    it('settles a docs-only PR without the ci.yml job', () => {
      const { marker } = runChunk(
        [
          job('Smoke tests on Vercel preview', 'skipping', 'Preview smoke'),
          commitStatus('pending'),
        ],
        'docs/PROJECT_SPEC.md',
      )

      expect(marker).toBe('CI_SETTLED')
    })
  })
})
