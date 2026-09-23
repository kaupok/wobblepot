import { defineConfig, globalIgnores } from 'eslint/config'
import nextVitals from 'eslint-config-next/core-web-vitals'
import nextTs from 'eslint-config-next/typescript'
import testingLibrary from 'eslint-plugin-testing-library'
import storybook from 'eslint-plugin-storybook'
import { plugin as shadcn } from '@shadcn/lint'

// `shadcn/no-restyle` (HON-674) classifies a class through its own Tailwind
// grammar, which does not read our `@theme` spacing tokens or `@utility` names
// the way `no-unknown-classes` does — so it reports `h-touch` and `max-h-dialog`
// as "the grammar does not recognize it". Every one of these is layout (a
// height, a width cap, a grid track), so they are allowed wherever `layout` is.
// Contracts replace the top-level `allow` rather than extending it, so each
// contract spreads this list in.
// REMOVE WHEN: @shadcn/lint's `no-restyle` classifier reads custom `--spacing-*`
// tokens and `@utility` names from globals.css (checked against 0.1.0).
const UNCLASSIFIED_LAYOUT = [
  '*-touch',
  'min-h-screen-below-header',
  'min-h-screen-below-header-gutters',
  'scroll-mt-below-header',
  'max-h-dialog',
  'grid-cols-timeline',
  'grid-cols-shopping-row',
  'max-w-page',
]
const LAYOUT = ['layout', ...UNCLASSIFIED_LAYOUT]

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

  // @shadcn/lint (HON-673, HON-674). All six rules as CI errors. The first five
  // need no per-component judgment. The sixth, `no-restyle`, is the one the
  // plugin exists for: a page may place a primitive (`layout`), and each
  // contract below says what else that page may change and why; everything
  // else — size, shape, colour, padding — is a variant's job. It is off inside
  // `src/components/ui/**` (the override further down), where primitives
  // compose each other.
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
      'shadcn/no-restyle': [
        'error',
        {
          allow: LAYOUT,
          // The baseline for every primitive without a contract (`Skeleton`,
          // `Card`, `Select*`, `Dialog*` …) is placement and size only: width,
          // height, margin, flex and grid participation, position. Padding,
          // radius, colour and type are the component's, reached through its
          // variant and size props. Contracts replace `allow` for the
          // components they match, and the last matching contract wins.
          contracts: [
            // Whether a card has a header, a footer, or neither is the page's
            // decision, and the parts' padding is the seam that decision moves
            // (`pt-0` under a missing header, `px-3` in a dense `size="sm"`
            // card). `no-arbitrary-values` still keeps it on the scale.
            {
              pattern: '^Card(Content|Header|Footer)$',
              allow: [...LAYOUT, 'spacing'],
            },
            // Control height is the 44px touch floor below `md` (HON-612), set by
            // the `size` prop — so on the fixed-height controls a height class
            // is a size override even though the grammar files it under layout.
            // Width, margin and flex placement stay the page's. `Input` adds
            // search fields' `pl-9` / `pr-9` inset past a leading search icon
            // and a trailing clear button (the same at all four callsites), and
            // `font-mono` for codes and links shown to be copied.
            {
              pattern: '^(Button|SelectTrigger)$',
              allow: LAYOUT,
              deny: ['h-*', 'min-h-*', 'max-h-*', 'size-*'],
              message: {
                layout:
                  'Set a control height with the size prop, not a class: the default is the 44px touch floor.',
              },
            },
            {
              pattern: '^Input$',
              allow: [...LAYOUT, 'pl-9', 'pr-9', 'font-mono'],
              deny: ['h-*', 'min-h-*', 'max-h-*', 'size-*'],
              message: {
                layout:
                  'An Input is as tall as a default Button so a field and its button line up.',
              },
            },
            // The type primitives own size, weight and colour: `Body` and `Li`
            // through `variant` and `tone`, `Badge` through `variant` (HON-675).
            // What stays a class is text *state*, not a level or a tone:
            // `italic` / `line-through` mark a vague quantity or a purchased
            // row; `uppercase` travels with `tracking-wide` because uppercase
            // without tracking is a legibility problem; `transition-colors` has
            // to sit on the element whose colour changes; `font-mono` is for
            // codes shown to be copied, as on `Input`.
            {
              pattern: '^Body$',
              allow: [
                ...LAYOUT,
                'italic',
                'line-through',
                'uppercase',
                'tracking-wide',
                'transition-colors',
                'font-mono',
              ],
            },
            // An option label beside a `RadioGroupItem` or `Checkbox` is normal
            // weight; a field label is medium. `Label` is a registry primitive,
            // so a variant there would drift on the next `shadcn add`.
            {
              pattern: '^Label$',
              allow: [...LAYOUT, 'font-normal'],
            },
            // `IngredientList` renders `Li` as a flex row: its `gap-*` is
            // layout, and `opacity-*` is the row's in-flight toggle state.
            {
              pattern: '^Li$',
              allow: [...LAYOUT, 'gap-*', 'opacity-*'],
            },
            // The "today" marker on `TimelineDayCard`. The callsite keeps a
            // non-colour cue beside it (docs/DESIGN.md → Color).
            {
              pattern: '^Heading$',
              allow: [...LAYOUT, 'text-primary'],
            },
          ],
        },
      ],
    },
  },

  // Arbitrary values inside the shadcn/ui primitives we pull from the registry
  // (`top-[50%]`, `translate-x-[-50%]`, `ring-[3px]`, `min-w-[8rem]`,
  // `h-[var(--radix-select-trigger-height)]` …) are upstream's, not ours —
  // rewriting them would be undone by the next `shadcn add`. The other four
  // rules still apply to these files.
  //
  // The exemption is an explicit list rather than `src/components/ui/**`,
  // because the rationale is provenance, not location: `confirm-dialog.tsx`,
  // `number-input.tsx` and `typography.tsx` live here but are ours, and a
  // directory glob would exempt them — and every future hand-written primitive —
  // silently. Listed this way a new file is covered by the rule by default, and
  // a genuinely new registry component announces itself as a red build with an
  // obvious fix. Regenerate the list from what `shadcn add` actually installed.
  {
    files: [
      'src/components/ui/{alert-dialog,badge,button,card,checkbox,collapsible}.tsx',
      'src/components/ui/{dialog,dropdown-menu,input,label,radio-group,select}.tsx',
      'src/components/ui/{separator,sheet,skeleton,table,textarea,tooltip}.tsx',
    ],
    rules: { 'shadcn/no-arbitrary-values': 'off' },
  },

  // `no-restyle` is off inside the primitives themselves: they compose each
  // other (`AlertDialogAction` renders `buttonVariants()`, `NumberInput` wraps
  // `Input`), and the rule would read that composition as a restyle. A variant
  // added here is the fix the rule points callsites at, not a finding.
  {
    files: ['src/components/ui/**/*.{ts,tsx}'],
    rules: { 'shadcn/no-restyle': 'off' },
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
