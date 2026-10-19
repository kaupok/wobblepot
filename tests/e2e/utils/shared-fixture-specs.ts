// COMPONENTS: Playwright projects (shared-fixture / isolated split, HON-1182)

/**
 * Specs that sign in as a seeded fixture from `./fixtures.ts`. They all act
 * inside the one seeded "Smoke Test Household" (or churn the forgot-password
 * account's password), so two of them running at once can see each other's
 * rows. `playwright.config.ts` puts these in the `shared-fixture` project,
 * which CI runs on one worker; every other spec goes to the `isolated`
 * project, which runs in parallel.
 *
 * `shared-fixture-specs.test.ts` fails `pnpm test` when a spec signs in as a
 * fixture and is missing here, or is listed here and no longer does.
 */
export const SHARED_FIXTURE_SPECS = [
  'forgot-password.spec.ts',
  'make-it-my-recipe.spec.ts',
  'mcp-read.spec.ts',
  'mcp-write.spec.ts',
  'meal-card-click.spec.ts',
  'modal-focus-restore.spec.ts',
  'note-placement.spec.ts',
  'past-meals.spec.ts',
  'shopping-to-pantry.spec.ts',
  'smoke.spec.ts',
] as const

/** Globs for a Playwright project's `testMatch` / `testIgnore`. */
export const SHARED_FIXTURE_SPEC_GLOBS = SHARED_FIXTURE_SPECS.map((file) => `**/${file}`)

/**
 * A spec signs in as a fixture when a code line calls a fixture helper or
 * reads a fixture credential directly (`smoke.spec.ts` predates the helpers).
 */
const FIXTURE_USE =
  /smokeFixture\(|forgotPasswordFixture\(|\b(SMOKE_TEST|FORGOT_PASSWORD_TEST)_(EMAIL|PASSWORD)\b/

// A line whose first non-space characters open a comment: `//`, `/*` or a
// JSDoc continuation `*`. Prose that names a helper must not count as use.
const COMMENT_LINE = /^\s*(\/\/|\/\*|\*)/

export function usesSeededFixture(source: string): boolean {
  return source.split('\n').some((line) => !COMMENT_LINE.test(line) && FIXTURE_USE.test(line))
}

export interface FixtureSpecDrift {
  /** Sign in as a fixture but would run in the parallel `isolated` project. */
  unlisted: string[]
  /** Listed as shared-fixture but missing, or no longer sign in as a fixture. */
  stale: string[]
}

/**
 * Compares the spec files on disk (file name → source) with the list.
 * Both arrays empty means the split is correct.
 */
export function findFixtureSpecDrift(
  specs: ReadonlyMap<string, string>,
  listed: readonly string[] = SHARED_FIXTURE_SPECS,
): FixtureSpecDrift {
  const usesFixture = new Set(
    [...specs].filter(([, source]) => usesSeededFixture(source)).map(([file]) => file),
  )
  return {
    unlisted: [...usesFixture].filter((file) => !listed.includes(file)).sort(),
    stale: listed.filter((file) => !usesFixture.has(file)),
  }
}
