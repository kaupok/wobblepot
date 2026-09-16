import { defineConfig, globalIgnores } from 'eslint/config'
import nextVitals from 'eslint-config-next/core-web-vitals'
import nextTs from 'eslint-config-next/typescript'
import testingLibrary from 'eslint-plugin-testing-library'
import storybook from 'eslint-plugin-storybook'
import { plugin as shadcn } from '@shadcn/lint'

const config = defineConfig([
  // Next.js + TypeScript base rules (native flat config)
  ...nextVitals,
  ...nextTs,

  // WHY: ESLint 10 workaround (HON-313). `eslint-config-next` sets
  // `settings.react.version = 'detect'`, and eslint-plugin-react@7.37.5 resolves
  // that through the `context.getFilename()` API that ESLint 10 removed, so every
  // react rule throws `TypeError: contextOrFilename.getFilename is not a function`.
  // Pinning the version explicitly skips the auto-detection branch entirely.
  // REMOVE WHEN: eslint-plugin-react ships a release containing
  // https://github.com/jsx-eslint/eslint-plugin-react/pull/4022 and
  // eslint-config-next picks it up. Tracking: https://github.com/vercel/next.js/issues/89764
  // ALSO BUMP: on every React major. '19' coerces to 19.0.0, so version-gated react
  // rules would keep evaluating against 19.0.0 after React 20 lands. No effect today
  // (a full lint run at '19' vs '19.2.8' is byte-identical).
  {
    settings: { react: { version: '19' } },
  },

  // Global ignores
  globalIgnores([
    '.next/**',
    'out/**',
    'build/**',
    'coverage/**',
    'storybook-static/**',
    'next-env.d.ts',
    // Vendored: regenerated verbatim by `msw init public`. msw 2.15 added its own
    // `/* eslint-disable */` header, which ESLint 10 then reports as an unused
    // directive on every run.
    'public/mockServiceWorker.js',
  ]),

  // TypeScript-specific rules
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      'no-console': 'warn',
      '@next/next/no-img-element': 'error',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
    },
  },

  // @shadcn/lint (HON-673). The five rules whose findings need no per-component
  // judgment, as CI errors. The sixth — `no-restyle`, the one the plugin exists
  // for — is registered `off` at the bottom of this block; HON-674 (layout,
  // shape, spacing) and HON-675 (typography, colour) turn it on and reuse this
  // block and the `src/components/ui/**` override below.
  //
  // Tests and stories are excluded wholesale, through `ignores` rather than
  // per-line disables: test fixtures use fake class names on purpose (`class-1`,
  // `custom-class`) and stories size their canvas with arbitrary values. Neither
  // ships. The plugin reads `components.json` and `src/app/globals.css` itself,
  // so it already knows our primitives, theme tokens, and `@utility` names.
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['**/*.{test,spec}.{ts,tsx}', '**/*.stories.tsx'],
    plugins: { shadcn },
    settings: {
      shadcn: {
        note: 'See docs/DESIGN.md.',
        // `buttonVariants` is our own cva factory (src/components/ui/button.tsx),
        // so a className built from it is the design system speaking, not a
        // string the callsite assembled. Without this, `require-static-classes`
        // reports every `buttonVariants({ variant: 'destructive' })` — pushing
        // callsites back to hand-copying the variant's classes, which is the
        // drift the rule exists to prevent. `cva` and `tv` are built in; this
        // adds the one factory we export.
        variantFunctions: ['buttonVariants'],
      },
    },
    rules: {
      'shadcn/no-raw-colors': 'error',
      'shadcn/no-inline-styles': 'error',
      'shadcn/no-arbitrary-values': [
        'error',
        {
          allow: [
            // Device safe-area insets. No theme token or scale value can express
            // `env()`, and the calc() composition differs at each of the four
            // callsites, so the class is the clearest place for it to live.
            '*env(safe-area-inset-*',
            // shadcn's own colour+shadow transition idiom. `src/components/ui/**`
            // is exempt below, but `tag-input.tsx` mirrors `input.tsx` and must
            // not drift from it. There is no non-arbitrary spelling that means
            // the same thing: `transition-colors` drops box-shadow and
            // `transition-shadow` drops colour — they replace, not compose.
            'transition-[color,box-shadow]',
          ],
        },
      ],
      'shadcn/no-unknown-classes': 'error',
      'shadcn/require-static-classes': 'error',
      // Off on purpose. It needs per-component contracts, and the ~134 findings
      // on the type primitives need a design decision first (DESIGN.md → Open
      // questions). See HON-674 and HON-675.
      'shadcn/no-restyle': 'off',
    },
  },

  // shadcn/ui primitives are generated from the registry and re-pulled verbatim,
  // so their arbitrary values (`top-[50%]`, `translate-x-[-50%]`, `ring-[3px]`,
  // `min-w-[8rem]`, `h-[var(--radix-select-trigger-height)]` …) are upstream's,
  // not ours — rewriting them would be undone by the next `shadcn add`. The
  // other four rules still apply here.
  //
  // That rationale is provenance, not location, so the three files under this
  // directory that we wrote ourselves are excluded from the exemption: `shadcn
  // add` will never overwrite them, and an arbitrary value there is ours to fix.
  // Keep this list in step with what is actually pulled from the registry.
  {
    files: ['src/components/ui/**/*.{ts,tsx}'],
    ignores: [
      'src/components/ui/confirm-dialog.tsx',
      'src/components/ui/number-input.tsx',
      'src/components/ui/typography.tsx',
    ],
    rules: { 'shadcn/no-arbitrary-values': 'off' },
  },

  // Testing Library rules (only for test files)
  {
    files: ['**/*.{test,spec}.?(c|m)[jt]s?(x)'],
    ignores: ['tests/e2e/**'],
    plugins: { 'testing-library': testingLibrary },
    rules: {
      'testing-library/await-async-queries': 'error',
      'testing-library/no-wait-for-side-effects': 'error',
      'testing-library/no-promise-in-fire-event': 'error',
      'testing-library/prefer-screen-queries': 'warn',
      'testing-library/no-node-access': 'warn',
      'testing-library/no-container': 'warn',
    },
  },

  // Storybook rules (only for story files)
  ...storybook.configs['flat/recommended'],
])

export default config
