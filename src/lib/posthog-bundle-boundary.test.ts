import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// HON-999: posthog-js must reach the browser only through a dynamic import that
// runs after consent. One static value import anywhere in the client graph puts
// the whole SDK (about 100 KB gzipped) in the initial JS of every visitor, so a
// user who declined analytics downloads it on every page load. `@posthog/react`
// counts too: its entry imports posthog-js statically.
//
// Type-only imports are erased at build time and stay allowed.

const SRC = path.resolve(__dirname, '..')

/** The files allowed to `import('posthog-js')`: the two init paths and the gate every other caller uses. */
const DYNAMIC_IMPORT_ALLOWED = new Set([
  'components/PostHogProvider.tsx',
  'app/global-error.tsx',
  'lib/posthog-client-state.ts',
])

// Anchored at a line start so prose in comments does not match; `[^'"]` keeps
// a match inside one statement, because the previous import's quoted path stops it.
const STATIC_VALUE_IMPORT =
  /^(?:import|export)\s+(?!type\b)[^'"]*?\bfrom\s+['"](posthog-js|@posthog\/react)(\/[^'"]*)?['"]/m
const SIDE_EFFECT_IMPORT = /^\s*import\s+['"](posthog-js|@posthog\/react)(\/[^'"]*)?['"]/m
const DYNAMIC_IMPORT = /\bimport\(\s*['"]posthog-js['"]\s*\)/

function sourceFiles(): string[] {
  return readdirSync(SRC, { recursive: true, encoding: 'utf8' })
    .filter((file) => /\.(ts|tsx)$/.test(file))
    .filter((file) => !/\.(test|stories)\.tsx?$/.test(file))
    .map((file) => file.split(path.sep).join('/'))
}

describe('posthog-js bundle boundary', () => {
  it('no source file imports posthog-js or @posthog/react statically', () => {
    const offenders = sourceFiles().filter((file) => {
      const text = readFileSync(path.join(SRC, file), 'utf8')
      return STATIC_VALUE_IMPORT.test(text) || SIDE_EFFECT_IMPORT.test(text)
    })
    expect(offenders).toEqual([])
  })

  it('only the init paths and getLoadedPostHog() import posthog-js dynamically', () => {
    const offenders = sourceFiles().filter(
      (file) =>
        !DYNAMIC_IMPORT_ALLOWED.has(file) &&
        DYNAMIC_IMPORT.test(readFileSync(path.join(SRC, file), 'utf8')),
    )
    expect(offenders).toEqual([])
  })
})
