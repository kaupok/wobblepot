import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  ADMIN_PATHS,
  CATALOGS,
  checkTree,
  findCatalogViolations,
  findSourceViolations,
  isScannedFile,
  listAdminFiles,
  RULE,
} from './check-admin-untranslated'

/**
 * The guard is green on `main` by design, so most of these tests exist to
 * prove the tripwire fires — and that it stays quiet on what admin code may do.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** Violations in a snippet, as if it were an admin page. */
const hits = (source: string) => findSourceViolations('src/app/admin/example/page.tsx', source)

describe('findSourceViolations', () => {
  it.each([
    ['useTranslations from next-intl', `import { useTranslations } from 'next-intl'`],
    ['getTranslations from next-intl/server', `import { getTranslations } from 'next-intl/server'`],
    ['a type-only import', `import type { Locale } from 'next-intl'`],
    ['a namespace import', `import * as intl from 'next-intl'`],
    ['a re-export', `export { useTranslations } from 'next-intl'`],
    ['a dynamic import', `const { getTranslations } = await import('next-intl/server')`],
    ['useEnumLabel', `import { useEnumLabel } from '@/lib/i18n/enum-label'`],
    ['useVaguePhrase', `import { useVaguePhrase } from '@/lib/i18n/enum-label'`],
    ['an aliased useEnumLabel', `import { useEnumLabel as label } from '@/lib/i18n/enum-label'`],
    ['a dynamic import of enum-label', `await import('@/lib/i18n/enum-label')`],
    [
      'an import split across lines',
      `import {\n  getTranslations,\n  getLocale,\n} from 'next-intl/server'`,
    ],
  ])('flags %s', (_label, source) => {
    expect(hits(source)).toHaveLength(1)
  })

  it.each([
    ['inline English', `const title = 'Signup codes'`],
    ['another i18n helper', `import { formatQuantity } from '@/lib/i18n/format-number'`],
    ['a local function named like the hook', `const label = useEnumLabelLike('MealType')`],
    ['a package that only starts the same', `import x from 'next-intl-extra'`],
    ['a comment quoting the import', `// import { useTranslations } from 'next-intl'`],
    ['a string quoting the import', `const doc = "import { t } from 'next-intl'"`],
    ['a dynamic import of something else', `await import('@/lib/prisma')`],
  ])('ignores %s', (_label, source) => {
    expect(hits(source)).toEqual([])
  })

  it('reports the line of the offending statement', () => {
    const [violation] = hits(
      `import Link from 'next/link'\n\nimport { useTranslations } from 'next-intl'`,
    )
    expect(violation).toMatchObject({ file: 'src/app/admin/example/page.tsx', line: 3 })
    expect(violation!.snippet).toBe(`import { useTranslations } from 'next-intl'`)
  })
})

describe('findCatalogViolations', () => {
  const catalogHits = (json: string) => findCatalogViolations('messages/et.json', json)

  it('flags an admin key at the top level', () => {
    expect(catalogHits(`{\n  "admin": { "title": "x" }\n}`)).toEqual([
      { file: 'messages/et.json', line: 2, snippet: 'key admin' },
    ])
  })

  it('flags an admin key nested at any depth, with its key path and line', () => {
    const json = JSON.stringify(
      { nav: { home: 'Home', admin: { signupCodes: 'x' } }, meta: { a: { b: { admin: 'y' } } } },
      null,
      2,
    )
    expect(catalogHits(json)).toEqual([
      { file: 'messages/et.json', line: 4, snippet: 'key nav.admin' },
      { file: 'messages/et.json', line: 11, snippet: 'key meta.a.b.admin' },
    ])
  })

  it.each([
    ['a key that only starts with admin', `{ "administrator": "x", "adminLinks": "y" }`],
    ['admin as a value', `{ "role": "admin" }`],
    ['admin inside a message', `{ "hint": "Ask your \\"admin\\": they know" }`],
  ])('ignores %s', (_label, json) => {
    expect(catalogHits(json)).toEqual([])
  })
})

describe('isScannedFile', () => {
  it('reads the admin surface and skips tests, stories and everything else', () => {
    expect(isScannedFile('src/app/admin/signup-codes/page.tsx')).toBe(true)
    expect(isScannedFile('src/app/admin/layout.tsx')).toBe(true)
    expect(isScannedFile('src/app/api/admin/waitlist/route.ts')).toBe(true)
    expect(isScannedFile('src/lib/admin-links.ts')).toBe(true)
    expect(isScannedFile('src/app/admin/signup-codes/page.test.ts')).toBe(false)
    expect(isScannedFile('src/app/admin/waitlist/WaitlistClient.test.tsx')).toBe(false)
    expect(isScannedFile('src/app/admin/waitlist/WaitlistClient.stories.tsx')).toBe(false)
    expect(isScannedFile('src/app/administration/page.tsx')).toBe(false)
    expect(isScannedFile('src/lib/admin-links.test.ts')).toBe(false)
    expect(isScannedFile('src/components/header.tsx')).toBe(false)
  })

  it('every admin path exists', () => {
    for (const admin of ADMIN_PATHS) {
      expect(fs.existsSync(path.join(repoRoot, admin)), `${admin} does not exist`).toBe(true)
    }
  })
})

describe('the repository', () => {
  it('scans the admin pages, the admin routes and the admin links', () => {
    // A path that silently matched nothing would make the check below pass
    // vacuously.
    const files = listAdminFiles(repoRoot)
    expect(files).toContain('src/app/admin/signup-codes/page.tsx')
    expect(files).toContain('src/lib/admin-links.ts')
    expect(files.some((file) => file.startsWith('src/app/api/admin/'))).toBe(true)
    expect(CATALOGS.every((catalog) => fs.existsSync(path.join(repoRoot, catalog)))).toBe(true)
  })

  it('carries no admin translation', () => {
    const { violations } = checkTree(repoRoot)
    const report = violations.map((v) => `${v.file}:${v.line}  ${v.snippet}`)

    expect(report, RULE).toEqual([])
  })
})
