/**
 * Colocated story check (HON-757)
 *
 * CLAUDE.md → Storybook requires every component under `src/components/**` to
 * have a colocated `.stories.tsx`. Until this script, only the text enforced
 * that: `pnpm test-storybook:ci` runs the stories that exist, and nothing
 * noticed a component that had none. Agents write most components here, so the
 * rule most likely to be skipped quietly is also the one a machine can check.
 *
 * What it checks: the whole tree, not the PR diff. With a handful of
 * exceptions, a tree-wide scan is simpler, needs no base SHA, and also catches
 * a story deleted after the fact. A component passes when its own directory
 * holds `<basename>.stories.tsx`, compared case-insensitively — `Button.tsx`
 * pairs with `button.stories.tsx`.
 *
 * What it cannot check: whether a story covers every variant, or was updated
 * when its component changed. That stays with the PR reviewer, which is why
 * CLAUDE.md keeps the rule itself and only points here for enforcement.
 *
 * Usage: pnpm stories:check [path/to/repo-root]
 *   The root defaults to this repo, resolved from this file's own location so
 *   it does not depend on the working directory. The argument exists so the
 *   unit test can point the scan at a fixture tree.
 */

import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

// ============================================
// ALLOWLIST
// ============================================

/**
 * Components that deliberately have no colocated story. Every entry carries a
 * `why` — an exception nobody can explain is one nobody can safely remove.
 *
 * The list cannot go stale silently: an entry with an empty `why`, a path that
 * no longer exists, or a component that has since gained a story each fail the
 * check. Paths are repo-relative with forward slashes.
 *
 * Add an entry only for a component with nothing to render in isolation (a
 * context provider), or one whose rendering is already covered by the stories
 * of the parts it composes — and name those stories in the `why`.
 */
export interface AllowlistEntry {
  path: string
  why: string
}

export const ALLOWLIST: AllowlistEntry[] = [
  {
    path: 'src/components/theme-provider.tsx',
    why: 'Thin wrapper around the next-themes ThemeProvider (plus a null-rendering theme-color updater) with no UI of its own. Storybook drives the theme through the withTailwindTheme decorator in .storybook/preview.tsx instead.',
  },
  {
    path: 'src/components/ConsentProvider.tsx',
    why: 'Context provider for the analytics consent state. Its only UI is CookieBanner, mounted while no decision is stored, which has its own story (CookieBanner.stories.tsx), as does CookieSettingsTrigger.',
  },
  {
    path: 'src/components/PostHogProvider.tsx',
    why: 'Analytics provider that initialises PostHog and renders only its children — nothing to show in isolation, and Storybook must not send analytics.',
  },
  {
    path: 'src/components/inventory/InventoryPage.tsx',
    why: 'The /shopping page shell: a two-column grid around PantrySection, ShoppingSection and ShoppingEmptyState, each of which has its own story. Scenarios/Shopping list (src/stories/scenarios/ShoppingList.stories.tsx) covers the composed screen, and InventoryPage.test.tsx covers the state it wires between the two halves.',
  },
]

// ============================================
// SCAN
// ============================================

const COMPONENTS_DIR = 'src/components'

/** Every component file under `src/components`, as repo-relative paths. */
export function listComponents(repoRoot: string): string[] {
  const components: string[] = []

  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(full)
        continue
      }
      if (!entry.isFile() || !isComponentFile(entry.name)) continue
      components.push(toRepoPath(repoRoot, full))
    }
  }

  walk(path.join(repoRoot, COMPONENTS_DIR))
  return components.sort()
}

/** A `.tsx` file that is not a test, a story, or a barrel. */
export function isComponentFile(name: string): boolean {
  return (
    name.endsWith('.tsx') &&
    !name.endsWith('.test.tsx') &&
    !name.endsWith('.stories.tsx') &&
    name !== 'index.tsx'
  )
}

/** Whether `<basename>.stories.tsx` sits beside the component, any case. */
export function hasColocatedStory(repoRoot: string, componentPath: string): boolean {
  const dir = path.join(repoRoot, path.dirname(componentPath))
  const expected = `${path.basename(componentPath, '.tsx')}.stories.tsx`.toLowerCase()
  return readdirSync(dir).some((name) => name.toLowerCase() === expected)
}

function toRepoPath(repoRoot: string, full: string): string {
  return path.relative(repoRoot, full).split(path.sep).join('/')
}

export interface Violation {
  path: string
  /** One-line statement of what is wrong and how to fix it. */
  message: string
}

export function findViolations(
  repoRoot: string,
  allowlist: AllowlistEntry[] = ALLOWLIST,
): Violation[] {
  const violations: Violation[] = []
  const allowed = new Set(allowlist.map((entry) => entry.path))
  const script = 'scripts/check-colocated-stories.ts'

  for (const component of listComponents(repoRoot)) {
    if (allowed.has(component) || hasColocatedStory(repoRoot, component)) continue
    const story = component.replace(/\.tsx$/, '.stories.tsx')
    violations.push({
      path: component,
      message:
        `${component} has no colocated story — add ${story} (see .storybook/README.md) ` +
        `or allowlist it with a reason in ${script}`,
    })
  }

  for (const entry of allowlist) {
    if (entry.why.trim() === '') {
      violations.push({
        path: entry.path,
        message: `allowlist entry ${entry.path} has no reason — add a \`why\` in ${script}`,
      })
    }
    if (!existsSync(path.join(repoRoot, entry.path))) {
      violations.push({
        path: entry.path,
        message: `allowlist entry ${entry.path} no longer exists — remove it from ${script}`,
      })
    } else if (hasColocatedStory(repoRoot, entry.path)) {
      violations.push({
        path: entry.path,
        message: `allowlist entry ${entry.path} now has a colocated story — remove it from ${script}`,
      })
    }
  }

  return violations
}

// ============================================
// MAIN
// ============================================

const defaultRepoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/**
 * Fewest components a real `src/components` tree for this repo can hold (96 on
 * 2026-09-23). A wrong root or an unreadable tree finds none, so no component
 * could fail and the script would report a green over nothing. If a real
 * cleanup ever trips this, lower the constant in the same commit.
 */
export const MIN_PLAUSIBLE_COMPONENTS = 50

export function checkTree(repoRoot: string): { count: number; violations: Violation[] } {
  const count = listComponents(repoRoot).length
  if (count < MIN_PLAUSIBLE_COMPONENTS) {
    throw new Error(
      `${path.join(repoRoot, COMPONENTS_DIR)} holds ${count} component(s), expected at least ` +
        `${MIN_PLAUSIBLE_COMPONENTS}. Refusing to report the tree as covered when the scan found almost nothing.`,
    )
  }
  return { count, violations: findViolations(repoRoot) }
}

function main(): void {
  const repoRoot = path.resolve(process.argv[2] ?? defaultRepoRoot)
  const { count, violations } = checkTree(repoRoot)

  if (violations.length === 0) {
    // Say what was checked, so a green step proves the scan ran.
    console.log(
      `✓ ${COMPONENTS_DIR}: ${count} component(s) have a colocated story or an allowlisted reason ` +
        `(${ALLOWLIST.length} allowlisted).`,
    )
    return
  }

  console.error(`\n✗ ${COMPONENTS_DIR}: ${violations.length} colocated-story violation(s)\n`)
  for (const violation of violations) {
    console.error(`  ✗ ${violation.message}`)
  }
  console.error(
    '\nCLAUDE.md → Storybook: every component under src/components needs a colocated\n' +
      '.stories.tsx covering its variants and states. Allowlist a component only when\n' +
      'it has nothing to render in isolation, or its parts are covered by their own\n' +
      'stories — and name them in the `why`.\n',
  )
  process.exitCode = 1
}

// Guarded so the unit test can import the helpers without running the scan.
const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (invokedDirectly) {
  try {
    main()
  } catch (error: unknown) {
    console.error(
      `\ncheck-colocated-stories failed: ${error instanceof Error ? error.message : String(error)}\n`,
    )
    process.exitCode = 1
  }
}
