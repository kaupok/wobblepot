/**
 * The Production deployment-record sweep in `deploy-code-production.yml` (HON-611).
 *
 * Every release writes a GitHub Production deployment record (HON-602) and the
 * `auto_inactive` flag on its `success` status is supposed to retire the
 * previous one. On this repo it demonstrably does not: 14 records claiming to
 * be ACTIVE had accumulated by 2026-09-03, most pointing at Vercel URLs that no
 * longer resolve. The `Retire superseded Production deployment records` step is
 * the explicit sweep that replaces it.
 *
 * That workflow is `workflow_dispatch` only and deploys production, so no PR
 * can exercise it — the first execution of any change to it is a real release.
 * This file is therefore the only oracle: it extracts the step's `run:` script
 * out of the YAML and runs it for real against a stubbed `gh`, the same harness
 * shape `ci-settle-gate.test.ts` uses on the skill snippets, and for the same
 * reason. Running it also discharges "the YAML still parses" and "`bash -n`
 * passes on the step script" on every CI run rather than once by hand.
 *
 * The failure it exists to catch first: the snippet as drafted in the issue
 * excluded the current record with `grep -v "^${DEPLOYMENT_ID}$"`, and under
 * `set -o pipefail` a grep that filters out its only input line exits 1. That
 * is the healthy steady state — one ACTIVE record, the one the run just wrote —
 * so it would have reddened every release.
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const workflow = path.join(repoRoot, '.github/workflows/deploy-code-production.yml')

const STEP = '- name: Retire superseded Production deployment records'
const SUCCESS_STEP = "- name: 'Record GitHub deployment: success'"
const FAILURE_STEP = "- name: 'Record GitHub deployment: failure'"

const read = () => fs.readFileSync(workflow, 'utf8')

/** The lines of one `- name: …` step, up to the next step at the same indent. */
function stepBlock(source: string, marker: string): string {
  const lines = source.split('\n')
  const start = lines.findIndex((line) => line.trim() === marker)
  if (start === -1) throw new Error(`step not found: ${marker}`)

  const indent = lines[start]!.indexOf('-')
  const rest = lines.slice(start + 1)
  const end = rest.findIndex(
    (line) => line.trim().startsWith('- name:') && line.indexOf('-') <= indent,
  )

  return [lines[start], ...(end === -1 ? rest : rest.slice(0, end))].join('\n')
}

/**
 * The step's `run:` script, dedented — what bash actually receives.
 *
 * Deliberately a text extraction rather than a YAML parse: `yaml` is not a
 * dependency of this repo, and adding one to read a block scalar would be a
 * production dependency bought for a test.
 */
function runScript(source: string, marker: string): string {
  const lines = stepBlock(source, marker).split('\n')
  const start = lines.findIndex((line) => line.trim() === 'run: |')
  if (start === -1) throw new Error(`no \`run: |\` block in step: ${marker}`)

  const body = lines.slice(start + 1)
  const indent = lines[start]!.search(/\S/) + 2
  const end = body.findIndex((line) => line.trim() !== '' && line.search(/\S/) < indent)

  return (end === -1 ? body : body.slice(0, end)).map((line) => line.slice(indent)).join('\n')
}

type Deployment = { databaseId: number; state: string }

const CURRENT = 6238572417

describe('Retire superseded Production deployment records', () => {
  describe('the step as declared', () => {
    it('runs after the success status and before the failure status', () => {
      const source = read()

      expect(source.indexOf(SUCCESS_STEP)).toBeGreaterThan(-1)
      expect(source.indexOf(STEP)).toBeGreaterThan(source.indexOf(SUCCESS_STEP))
      expect(source.indexOf(FAILURE_STEP)).toBeGreaterThan(source.indexOf(STEP))
    })

    // Both clauses are load-bearing. Without the id guard the request URL is
    // malformed when the create step wrote nothing; without `success()` a run
    // whose success status failed to post would retire the previous record
    // while its own sits at IN_PROGRESS, leaving the environment with no ACTIVE
    // record at all — a blank card, worse than a stale one.
    it('is guarded by success() and a non-empty deployment_id', () => {
      expect(stepBlock(read(), STEP)).toContain(
        "if: success() && steps.gh_deployment.outputs.deployment_id != ''",
      )
    })

    // The deploy has already shipped by the time this runs, so a red run beside
    // a green deploy step is the honest signal that bookkeeping did not finish.
    // Same rule the two status steps around it follow. Asserted on the YAML
    // key, not the string: the step's own comment names `continue-on-error` to
    // explain why it does not carry one, and prose cannot swallow a failure.
    it('carries no continue-on-error', () => {
      const keys = stepBlock(read(), STEP)
        .split('\n')
        .filter((line) => line.trimStart().startsWith('continue-on-error'))

      expect(keys).toEqual([])
    })

    it('leaves the job permissions at contents: read + deployments: write', () => {
      expect(read()).toContain('    permissions:\n      contents: read\n      deployments: write\n')
    })

    it('needs no secret beyond the workflow token', () => {
      const block = stepBlock(read(), STEP)

      expect(block).toContain('GH_TOKEN: ${{ github.token }}')
      expect(block).not.toContain('secrets.')
    })
  })

  // The script itself, executed. `gh` is stubbed on PATH: the graphql call
  // replays a fixture through the caller's own `--jq`, so the filter under test
  // is the real one, and each status POST is appended to a log.
  describe('the script, executed', () => {
    let stubBin: string
    let script: string
    let callLog: string

    beforeAll(() => {
      stubBin = fs.mkdtempSync(path.join(os.tmpdir(), 'hon611-bin-'))
      callLog = path.join(stubBin, 'status-calls')

      fs.writeFileSync(
        path.join(stubBin, 'gh'),
        [
          '#!/bin/sh',
          'if [ "$1" = "api" ] && [ "$2" = "graphql" ]; then',
          '  [ -n "$STUB_GRAPHQL_FAILS" ] && { echo "gh: HTTP 502" >&2; exit 1; }',
          '  jq_expr=""',
          '  while [ $# -gt 0 ]; do [ "$1" = "--jq" ] && jq_expr="$2"; shift; done',
          '  printf \'%s\' "$STUB_DEPLOYMENTS" | jq -r "$jq_expr"',
          '  exit 0',
          'fi',
          'if [ "$1" = "api" ]; then',
          `  echo "$2" >> ${JSON.stringify(callLog)}`,
          // Everything after `deployments/` up to `/statuses` — the id being retired.
          "  id=$(printf '%s' \"$2\" | sed -e 's#.*/deployments/##' -e 's#/statuses##')",
          '  if [ "$id" = "$STUB_FAIL_ID" ]; then echo "gh: HTTP 500" >&2; exit 1; fi',
          '  exit 0',
          'fi',
          '',
        ].join('\n'),
        { mode: 0o755 },
      )

      script = path.join(stubBin, 'retire.sh')
      fs.writeFileSync(script, runScript(read(), STEP))
    })

    afterAll(() => fs.rmSync(stubBin, { recursive: true, force: true }))

    /** Run the step against a fixture. Returns its exit code, stdout and the ids it retired. */
    function run(
      nodes: Deployment[],
      { failOn, graphqlFails }: { failOn?: number; graphqlFails?: boolean } = {},
    ) {
      fs.rmSync(callLog, { force: true })

      let status = 0
      let stdout = ''
      try {
        stdout = execFileSync('bash', [script], {
          encoding: 'utf8',
          timeout: 60_000,
          env: {
            ...process.env,
            PATH: `${stubBin}:${process.env.PATH}`,
            GITHUB_REPOSITORY: 'kaupok/wobblepot',
            DEPLOYMENT_ID: String(CURRENT),
            STUB_DEPLOYMENTS: JSON.stringify({
              data: { repository: { deployments: { nodes } } },
            }),
            STUB_FAIL_ID: failOn === undefined ? '' : String(failOn),
            STUB_GRAPHQL_FAILS: graphqlFails ? '1' : '',
          },
        })
      } catch (error) {
        const failure = error as { status?: number; stdout?: string }
        status = failure.status ?? 1
        stdout = String(failure.stdout ?? '')
      }

      const calls = fs.existsSync(callLog)
        ? fs.readFileSync(callLog, 'utf8').trim().split('\n').filter(Boolean)
        : []

      return {
        status,
        stdout,
        endpoints: calls,
        retired: calls.map((call) =>
          Number(call.replace(/.*\/deployments\/(\d+)\/statuses/, '$1')),
        ),
      }
    }

    it('retires the previous release and leaves this run’s record alone', () => {
      const { status, retired, endpoints } = run([
        { databaseId: CURRENT, state: 'ACTIVE' },
        { databaseId: 6238000000, state: 'ACTIVE' },
      ])

      expect(status).toBe(0)
      expect(retired).toEqual([6238000000])
      expect(endpoints[0]).toBe('repos/kaupok/wobblepot/deployments/6238000000/statuses')
    })

    // The regression this file exists for: the issue's `grep -v` form exits 1
    // here under pipefail, reddening a release that went perfectly.
    it('exits clean when this run’s record is the only ACTIVE one', () => {
      const { status, retired, stdout } = run([{ databaseId: CURRENT, state: 'ACTIVE' }])

      expect(status).toBe(0)
      expect(retired).toEqual([])
      expect(stdout).toContain('Retired 0 superseded record(s)')
    })

    it('exits clean when nothing is ACTIVE at all', () => {
      const { status, retired } = run([
        { databaseId: 3182270119, state: 'FAILURE' },
        { databaseId: 3184292355, state: 'INACTIVE' },
      ])

      expect(status).toBe(0)
      expect(retired).toEqual([])
    })

    // FAILURE records are honest history of a failed deploy and INACTIVE ones
    // are already retired; only ACTIVE is the problem this step solves.
    it('never touches FAILURE, INACTIVE, IN_PROGRESS, ERROR or QUEUED records', () => {
      const { status, retired } = run([
        { databaseId: CURRENT, state: 'ACTIVE' },
        { databaseId: 1, state: 'FAILURE' },
        { databaseId: 2, state: 'INACTIVE' },
        { databaseId: 3, state: 'IN_PROGRESS' },
        { databaseId: 4, state: 'ERROR' },
        { databaseId: 5, state: 'QUEUED' },
        { databaseId: 6, state: 'ACTIVE' },
      ])

      expect(status).toBe(0)
      expect(retired).toEqual([6])
    })

    // The backlog case, and the word-splitting one: a `for id in $ACTIVE_IDS`
    // form folds every id into a single malformed URL under a shell that does
    // not split unquoted expansions, which is where the snippet was drafted.
    it('retires a whole backlog, one request per record', () => {
      const backlog = [3184652624, 3184292355, 3183945021, 3183112004, 3182270119]
      const { status, retired, stdout } = run([
        { databaseId: CURRENT, state: 'ACTIVE' },
        ...backlog.map((databaseId) => ({ databaseId, state: 'ACTIVE' })),
      ])

      expect(status).toBe(0)
      expect(retired).toEqual(backlog)
      expect(stdout).toContain('Retired 5 superseded record(s)')
    })

    // No `continue-on-error` on the step, so a half-finished sweep has to redden
    // the run — the operator needs to know the environment page is wrong.
    it('fails the step when a status POST is rejected', () => {
      const { status, retired } = run(
        [
          { databaseId: CURRENT, state: 'ACTIVE' },
          { databaseId: 111, state: 'ACTIVE' },
          { databaseId: 222, state: 'ACTIVE' },
        ],
        { failOn: 111 },
      )

      expect(status).not.toBe(0)
      expect(retired).toEqual([111])
    })

    it('fails the step when the deployments query itself fails', () => {
      const { status, retired } = run([{ databaseId: CURRENT, state: 'ACTIVE' }], {
        graphqlFails: true,
      })

      expect(status).not.toBe(0)
      expect(retired).toEqual([])
    })
  })
})
