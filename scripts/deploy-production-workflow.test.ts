/**
 * The wiring of `deploy-production.yml` (HON-1507).
 *
 * The workflow deploys production and is `workflow_dispatch` only, so no PR
 * runs it. This file reads the YAML as text, as `deployment-record-retire.test.ts`
 * does, and asserts the order and the commit each job ships: `pick` first,
 * `migrate` and `deploy` from the commit `pick` chose, and `deploy` only after
 * `migrate`. `pnpm format:check` is what proves the YAML still parses.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { SERVED_STEP } from './pick-production-sha'

const workflows = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../.github/workflows')
const read = (name: string) => fs.readFileSync(path.join(workflows, name), 'utf8')

/** The lines of one top-level job, up to the next job. */
function job(source: string, name: string): string {
  const lines = source.split('\n')
  const start = lines.indexOf(`  ${name}:`)
  if (start === -1) throw new Error(`job not found: ${name}`)
  const rest = lines.slice(start + 1)
  const end = rest.findIndex((line) => /^ {2}\S/.test(line) || /^\S/.test(line))
  return [lines[start], ...(end === -1 ? rest : rest.slice(0, end))].join('\n')
}

const PICKED = '${{ needs.pick.outputs.sha }}'

describe('deploy-production.yml', () => {
  const source = read('deploy-production.yml')

  it('runs pick, then migrate, then deploy', () => {
    const jobs = [...source.matchAll(/^ {2}([a-z-]+):$/gm)].map((match) => match[1])
    expect(jobs).toEqual(['pick', 'migrate', 'deploy'])
    expect(job(source, 'migrate')).toContain('    needs: pick\n')
    expect(job(source, 'deploy')).toContain('    needs: [pick, migrate]\n')
  })

  it('gives deploy no `if:`, so a failed migrate skips it', () => {
    expect(job(source, 'deploy')).not.toMatch(/^ {4}if:/m)
    expect(job(source, 'migrate')).not.toMatch(/^ {4}if:/m)
  })

  it('migrates from the picked commit', () => {
    const migrate = job(source, 'migrate')
    expect(migrate).toContain('    uses: ./.github/workflows/deploy-db-migrations-production.yml\n')
    expect(migrate).toContain(`      sha: ${PICKED}\n`)
  })

  it('deploys the picked commit and records the commit it checked out', () => {
    const deploy = job(source, 'deploy')
    expect(deploy).toContain(`          ref: ${PICKED}\n`)
    expect(deploy).not.toContain('ref: main')
    expect(deploy).toContain('run: echo "sha=$(git rev-parse HEAD)" >> "$GITHUB_OUTPUT"')
    expect(deploy).toContain('          SHA: ${{ steps.rev.outputs.sha }}\n')
    expect(deploy).toContain('            "ref": "${SHA}",\n')
  })

  it('picks with the script and the workflow input', () => {
    const pick = job(source, 'pick')
    expect(pick).toContain('      sha: ${{ steps.pick.outputs.sha }}\n')
    expect(pick).toContain('          INPUT_SHA: ${{ inputs.sha }}\n')
    expect(pick).toContain('        run: node scripts/pick-production-sha.ts\n')
  })

  it('never runs two production deploys at once', () => {
    expect(source).toContain('concurrency:\n  group: production\n  cancel-in-progress: false')
  })
})

describe('deploy-db-migrations-production.yml', () => {
  const source = read('deploy-db-migrations-production.yml')

  it('can be called with a SHA and still dispatched on its own', () => {
    expect(source).toMatch(/^ {2}workflow_call:\n {4}inputs:\n {6}sha:\n/m)
    expect(source).toMatch(/^ {2}workflow_dispatch:$/m)
  })

  it('checks out the SHA it was called with', () => {
    expect(source).toContain('          ref: ${{ inputs.sha }}\n')
  })
})

describe('staging-smoke.yml', () => {
  it('names each run after the commit it tests, which the pick reads', () => {
    expect(read('staging-smoke.yml')).toContain(
      'run-name: Staging smoke ${{ github.event.workflow_run.head_sha || github.sha }}\n',
    )
  })

  it('runs the step the pick checks only when staging served the named commit itself', () => {
    const source = read('staging-smoke.yml')
    expect(source).toContain(
      `      - name: ${SERVED_STEP}\n` +
        '        if: steps.wait.outputs.served == (github.event.workflow_run.head_sha || github.sha)\n',
    )
    expect(source.match(/echo "served=\$actual_sha" >> "\$GITHUB_OUTPUT"/g)).toHaveLength(2)
  })
})

describe('the old code-only workflow', () => {
  it('is gone, so nobody ships code without its migrations', () => {
    expect(fs.existsSync(path.join(workflows, 'deploy-code-production.yml'))).toBe(false)
  })
})
