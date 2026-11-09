import type { KnipConfig } from 'knip'

// Dead-code gate (HON-1622): `pnpm knip` in CI fails on an unused file,
// export, type or dependency. The Next.js, Vitest, Storybook, Playwright,
// Prisma and ESLint plugins turn on from package.json and find their own entry
// files (routes, `*.test.ts`, `*.stories.tsx`, `tests/e2e/**`, configs).
// `src/generated` is gitignored, and knip skips gitignored files.
const config: KnipConfig = {
  // Scripts that a skill, a doc, a shell script or a config runs by path, so
  // no package.json script names them.
  entry: [
    // `.claude/skills/audit-ingredients/SKILL.md`
    'scripts/audit-ingredients/*.ts',
    // `scripts/e2e-local-seed.sh`
    'scripts/print-seed-test-user-defaults.ts',
    // the `check` command in each `scripts/steering-eval/*.json`
    'scripts/steering-eval/checks.ts',
    // the `next-intl/server` alias in `vitest.config.ts` (unit-db project)
    'src/test/next-intl-server-shim.ts',
  ],
  // Code templates for agents, copied into `src` by hand (`.claude/rules/auth.md`).
  ignore: ['.claude/templates/**'],
  // System binaries in shell calls, and the Vercel CLI that `env:audit` expects
  // on PATH. `script` is the BSD `script(1)` the orchestrator test runs.
  ignoreBinaries: ['vercel', 'script', 'pgrep', 'pkill'],
  // An export that its own file uses is not dead code, and dropping its
  // `export` keyword is churn with no reader benefit.
  ignoreExportsUsedInFile: true,
  ignoreIssues: {
    // shadcn/ui registry files: `shadcn add` writes their full export list, so
    // removing an unused part (`PopoverAnchor`) is undone on the next add. The
    // same list as the `no-arbitrary-values` exemption in eslint.config.mjs.
    'src/components/ui/{alert-dialog,badge,button,card,checkbox,collapsible}.tsx': [
      'exports',
      'types',
    ],
    'src/components/ui/{dialog,dropdown-menu,input,label,popover,select}.tsx': ['exports', 'types'],
    'src/components/ui/{separator,sheet,skeleton,table,textarea,toggle,tooltip}.tsx': [
      'exports',
      'types',
    ],
  },
}

export default config
