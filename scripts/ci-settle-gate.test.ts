/**
 * The CI-settle gate that decides when a PR may be merged (HON-600).
 *
 * The gate has three implementations that must agree: `pr_ci_state()` in
 * orchestrator.sh (covered in orchestrator.phase.test.ts) and two shell snippets
 * embedded in skill markdown — /auto-implement Phase 6.1 (which 7.2 re-runs),
 * and /merge Step 2. The markdown ones are the ones that actually merge PRs, and until
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
 * orchestrator.phase.test.ts, which tests the third implementation of the same rule.
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

type Check = { name: string; bucket: string; workflow: string }

/** A GitHub Actions job — always reports a non-empty `workflow`. */
const job = (name: string, bucket: string, workflow = 'CI'): Check => ({ name, bucket, workflow })
/** A commit status posted by a third-party app, e.g. Vercel's deploy. */
const commitStatus = (bucket: string): Check => ({ name: 'Vercel', bucket, workflow: '' })

/** The ci.yml job the loop refuses to settle without, on every PR (HON-1184). */
const CI_JOB = 'Lint, Type Check & Test'

describe('CI-settle gate', () => {
  describe('exemption is present at every site', () => {
    // The AC's own grep, as an assertion: two snippets in /auto-implement (6.1
    // poll + verify, which 7.2 re-runs) and two in /merge (Step 2 poll +
    // verify). A site that misses the filter is a site that strands PRs.
    it('appears twice in /auto-implement and twice in /merge', () => {
      expect(countOccurrences(readSkill(autoImplementSkill), EXEMPTION)).toBe(2)
      expect(countOccurrences(readSkill(mergeSkill), EXEMPTION)).toBe(2)
    })

    // Prose is excluded on purpose — only runnable lines can strand a PR.
    it('leaves no unfiltered `gh pr checks` call in any shell block', () => {
      for (const file of [autoImplementSkill, mergeSkill]) {
        const calls = bashBlocks(readSkill(file))
          .flatMap((block) => block.split('\n'))
          .filter((line) => line.includes('gh pr checks'))

        expect(calls.length, `${path.basename(file)} has no gh pr checks`).toBeGreaterThan(0)
        for (const line of calls) {
          // The call is split across two lines: the `gh` line names the fields,
          // the `--jq` line carries the filter. Assert on the fields here.
          expect(line, `${path.basename(file)}: ${line.trim()}`).toContain('workflow')
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
      for (const file of [autoImplementSkill, mergeSkill]) {
        const source = readSkill(file)
        expect(countOccurrences(source, 'DOCS_ONLY'), path.basename(file)).toBe(0)
        expect(countOccurrences(source, 'NON_DOCS'), path.basename(file)).toBe(0)

        const lines = bashBlocks(source)
          .flatMap((block) => block.split('\n'))
          .filter((line) => !line.trimStart().startsWith('#'))
          .filter((line) => line.includes('/files') || line.includes('changedFiles'))
        expect(lines, `${path.basename(file)}: ${lines.join(' / ')}`).toEqual([])
      }
    })

    // The rule that replaced it: the ci.yml job row, unconditionally, once per
    // poll loop. A guard in front of it (`[ … ] ||`) would bring an exemption back.
    it('requires the ci.yml job on every PR in both poll loops', () => {
      for (const file of [autoImplementSkill, mergeSkill]) {
        const source = readSkill(file)
        expect(
          countOccurrences(source, `  printf '%s\\n' "$CUR" | grep -q '^Lint, Type Check' || OK=0`),
          path.basename(file),
        ).toBe(1)
      }
    })

    // 7.2 used to carry a second, byte-identical copy of the loop. It now re-runs
    // 6.1's (HON-787), so there is one copy to keep right — and it has to stay in
    // SKILL.md, because every run waits on CI and a sibling file is read only on
    // demand.
    it('keeps exactly one /auto-implement poll loop, in SKILL.md, which 7.2 re-runs', () => {
      const skill = read(path.join(autoImplementSkill, 'SKILL.md'))
      const loops = bashBlocks(skill).filter((b) => b.includes('CI_SETTLED'))
      const merge = skill.slice(skill.indexOf('### 7.2 Wait for CI'), skill.indexOf('### 7.3'))

      expect(loops).toHaveLength(1)
      expect(
        bashBlocks(readSkill(autoImplementSkill)).filter((b) => b.includes('CI_SETTLED')),
      ).toHaveLength(1)
      expect(merge).toContain('Re-run the 6.1 poll')
      expect(merge).toContain('6.1 verification block')
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

      const [loop] = bashBlocks(read(path.join(autoImplementSkill, 'SKILL.md'))).filter((b) =>
        b.includes('CI_SETTLED'),
      )
      if (!loop) throw new Error('no CI_SETTLED poll loop found in the skill')
      pollScript = path.join(stubBin, 'poll.sh')
      fs.writeFileSync(pollScript, loop)
    })

    afterAll(() => fs.rmSync(stubBin, { recursive: true, force: true }))

    afterEach(() => {
      fs.rmSync(`/tmp/ci-poll-${prNumber}.prev`, { force: true })
      fs.rmSync(`/tmp/ci-poll-${prNumber}.chunks`, { force: true })
    })

    /**
     * Run one chunk of the loop. Returns its marker and the poll count.
     *
     * The stub serves no file list: the loop must decide from the check list
     * alone, so a docs-only PR and a code PR with the same checks look the same.
     */
    function runChunk(checks: Check[]) {
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
  })
})
