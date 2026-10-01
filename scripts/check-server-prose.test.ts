import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  checkTree,
  EXCLUDED_DIRS,
  findViolations,
  isScannedFile,
  listSourceFiles,
} from './check-server-prose'

/**
 * The guard is green on `main` by design, so most of these tests exist to
 * prove the tripwire fires — and that it stays quiet on the shapes the
 * codebase uses to do the right thing.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** Violations in a snippet, as if it were a component file. */
const hits = (source: string) => findViolations('src/components/Example.tsx', source)

describe('findViolations', () => {
  it.each([
    ['toast.error(err.message)', `onError: (err) => toast.error(err.message)`],
    ['bare toast', `toast(error.message)`],
    ['optional chain', `toast.error(mutation.error?.message)`],
    ['underscore name', `toast.error(_err instanceof Error ? _err.message : 'Failed')`],
    ['ternary fallback', `setError(err instanceof Error ? err.message : t('errors.generic'))`],
    ['nullish fallback', `setError(error.message ?? t('errors.generic'))`],
    ['template literal', 'toast.error(`Failed: ${err.message}`)'],
    ['named error setter', `setSaveError(saveError.message)`],
    ['cast', `toast.error((err as Error).message)`],
    [
      'split across lines',
      `toast.error(
        err instanceof Error
          ? err.message
          : tMembers('removeFailed'),
      )`,
    ],
  ])('flags %s', (_label, source) => {
    expect(hits(source)).toHaveLength(1)
  })

  it.each([
    ['catalog copy', `toast.error(t('errors.saveFailed'))`],
    ['logging', `console.error('[x] failed', err.message)`],
    ['mapper call owns the mapping', `setError(friendly(ctx.error?.message ?? ''))`],
    ['branch on status, not message', `toast.error(err.status === 409 ? t('dup') : t('failed'))`],
    ['non-error object', `toast.success(result.message)`],
    ['unrelated setter', `setMessage(err.message)`],
    ['setter that only looks similar', `setterError(err.message)`],
    ['comment quoting the pattern', `// never write toast.error(err.message)\ntoast.error(t('x'))`],
    ['string quoting the pattern', `const doc = 'toast.error(err.message)'`],
  ])('ignores %s', (_label, source) => {
    expect(hits(source)).toEqual([])
  })

  it('reports the line of the offending call', () => {
    const [violation] = hits(
      `const a = 1\n\nfunction f(err: Error) {\n  toast.error(err.message)\n}`,
    )
    expect(violation).toMatchObject({ file: 'src/components/Example.tsx', line: 4 })
    expect(violation!.snippet).toBe('toast.error(err.message)')
  })
})

describe('isScannedFile', () => {
  it('reads app source and skips tests, stories, declarations and excluded dirs', () => {
    expect(isScannedFile('src/components/Foo.tsx')).toBe(true)
    expect(isScannedFile('src/hooks/use-foo.ts')).toBe(true)
    expect(isScannedFile('src/components/Foo.test.tsx')).toBe(false)
    expect(isScannedFile('src/components/Foo.stories.tsx')).toBe(false)
    expect(isScannedFile('src/types/env.d.ts')).toBe(false)
    expect(isScannedFile('src/app/admin/signup-codes/SignupCodesClient.tsx')).toBe(false)
    expect(isScannedFile('src/app/administration/Page.tsx')).toBe(true)
  })

  it('every excluded directory exists and carries a reason', () => {
    for (const dir of EXCLUDED_DIRS) {
      expect(dir.why.trim(), `${dir.path} has no reason`).not.toBe('')
      expect(fs.existsSync(path.join(repoRoot, dir.path)), `${dir.path} does not exist`).toBe(true)
    }
  })
})

describe('the src tree', () => {
  it('scans a plausible number of files', () => {
    // A glob or root that silently matched nothing would make the check below
    // pass vacuously.
    expect(listSourceFiles(repoRoot).length).toBeGreaterThan(200)
  })

  it("renders no caught error's .message", () => {
    const { violations } = checkTree(repoRoot)
    const report = violations.map((v) => `${v.file}:${v.line}  ${v.snippet}`)

    expect(
      report,
      "Calls that render a caught error's .message. Log it and render catalog copy " +
        'chosen by ApiError.status / code instead (CLAUDE.md → Localization).',
    ).toEqual([])
  })
})
