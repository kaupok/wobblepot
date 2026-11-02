/**
 * `scripts/e2e-local.sh` toolchain preparation (HON-1315): each step runs only
 * when its input is newer than its output. Setup: `e2e-local.fixtures.ts`.
 */
import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  calls,
  CLIENT,
  LOCKFILE,
  MODULES,
  PNPM_STUB,
  root,
  run,
  SCHEMA,
  setupScratchRepo,
  stubDir,
  touch,
} from './e2e-local.fixtures'

setupScratchRepo()

describe('e2e-local.sh toolchain preparation', () => {
  const INSTALL = 'pnpm install --frozen-lockfile'
  const GENERATE = 'pnpm db:generate'
  const CHROMIUM = 'pnpm exec playwright install chromium'

  it('runs no install or generate step when everything is up to date', () => {
    const { status } = run([])
    const log = calls()

    expect(status).toBe(0)
    expect(log).toContain('pnpm exec playwright install --dry-run chromium')
    expect(log).not.toContain(INSTALL)
    expect(log).not.toContain(GENERATE)
    expect(log).not.toContain(CHROMIUM)
  })

  it.each([
    ['the lockfile is newer than node_modules', () => touch(LOCKFILE, new Date())],
    ['node_modules has no .modules.yaml', () => fs.rmSync(path.join(root, MODULES))],
  ])('installs dependencies when %s', (_case, arrange) => {
    arrange()
    const { status, stderr } = run([])

    expect(status).toBe(0)
    expect(calls()).toContain(INSTALL)
    expect(stderr).toContain('installing dependencies')
  })

  it.each([
    ['the schema is newer than the client', () => touch(SCHEMA, new Date())],
    ['there is no generated client', () => fs.rmSync(path.join(root, CLIENT))],
  ])('regenerates the Prisma client when %s', (_case, arrange) => {
    arrange()
    const { status, stderr } = run([])

    expect(status).toBe(0)
    expect(calls()).toContain(GENERATE)
    expect(stderr).toContain('regenerating it')
  })

  it('installs Chromium when one of its builds is incomplete', () => {
    fs.rmSync(path.join(stubDir, 'browsers', 'chromium-1'), { recursive: true })
    const { status, stderr } = run([])

    expect(status).toBe(0)
    expect(calls()).toContain(CHROMIUM)
    expect(stderr).toContain('Installing the Chromium build')
  })

  it.each(['run', 'serve'])(
    'prepares everything before %s creates a branch or starts a server',
    (command) => {
      touch(LOCKFILE, new Date())
      touch(SCHEMA, new Date())
      fs.rmSync(path.join(stubDir, 'browsers', 'chromium-1'), { recursive: true })
      const { status } = run([command])
      const log = calls()
      const start = log.indexOf(
        command === 'run' ? 'pnpm exec playwright test' : 'pnpm exec next dev',
      )

      expect(status).toBe(0)
      expect(log.indexOf(INSTALL)).toBeGreaterThanOrEqual(0)
      expect(log.indexOf(GENERATE)).toBeGreaterThan(log.indexOf(INSTALL))
      expect(log.indexOf(CHROMIUM)).toBeGreaterThan(log.indexOf(GENERATE))
      expect(log.indexOf('branches create')).toBeGreaterThan(log.indexOf(CHROMIUM))
      expect(start).toBeGreaterThan(log.indexOf('branches create'))
    },
  )

  it('prepares the toolchain for serve --db env too', () => {
    touch(SCHEMA, new Date())
    const { status } = run(['serve', '--db', 'env'])

    expect(status).toBe(0)
    expect(calls().indexOf('pnpm exec next dev')).toBeGreaterThan(calls().indexOf(GENERATE))
  })

  it.each([
    ['install', () => touch(LOCKFILE, new Date()), INSTALL],
    ['generate', () => touch(SCHEMA, new Date()), GENERATE],
    [
      'chromium',
      () => fs.rmSync(path.join(stubDir, 'browsers', 'chromium-1'), { recursive: true }),
      CHROMIUM,
    ],
  ])('stops on a failing %s step, names it and creates no branch', (step, arrange, name) => {
    arrange()
    const { status, stderr } = run([], { STUB_FAIL_STEP: step })

    expect(status).toBe(1)
    expect(stderr).toContain(`toolchain step '${name}' failed`)
    expect(calls()).not.toContain('neonctl')
    expect(calls()).not.toContain('playwright test')
  })

  // A changed dry-run format must not leave a run with no browser.
  it('installs Chromium when the dry run names no install location', () => {
    fs.writeFileSync(
      path.join(root, 'bin', 'pnpm'),
      PNPM_STUB.replace(
        `"exec playwright install --dry-run chromium")`,
        `"exec playwright install --dry-run chromium") echo "new format" ;;\n  "unused")`,
      ),
      { mode: 0o755 },
    )
    run([])

    expect(calls()).toContain(CHROMIUM)
  })
})
