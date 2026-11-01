/**
 * Herb rows whose pantry stock covers a recipe line for the bare herb (HON-1558).
 *
 * Recipes name the bare row (`basil`), which holds the form shops sell most.
 * A household names the form of the jar or bunch it has (`dried basil`). For
 * the shopping list, either form at home satisfies a bare line. A bare row
 * that holds the fresh plant also satisfies its `fresh` line
 * (`FRESH_BARE_HERBS`, HON-1567); a `dried basil` line is satisfied only by
 * its own row.
 *
 * Legumes are left out on purpose: dried chickpeas do not cover a tin
 * (HON-1549). So are `ground coriander` and `ground ginger`, which are
 * different foods from the leaf and the fresh root.
 *
 * Every name MUST exist in the global catalogue; `pnpm db:validate` checks it.
 */
export const INGREDIENT_FORM_COVERS: Readonly<Record<string, string>> = {
  'fresh basil': 'basil',
  'dried basil': 'basil',
  'fresh parsley': 'parsley',
  'dried parsley': 'parsley',
  // There is no `dried coriander` row: the dried seed is `ground coriander`.
  'fresh coriander': 'coriander',
  'fresh dill': 'dill',
  'dried dill': 'dill',
  'fresh mint': 'mint',
  'dried mint': 'mint',
  'fresh chives': 'chives',
  'dried chives': 'chives',
  'fresh tarragon': 'tarragon',
  'dried tarragon': 'tarragon',
  'fresh sage': 'sage',
  'dried sage': 'sage',
  'fresh marjoram': 'marjoram',
  'dried marjoram': 'marjoram',
  'fresh thyme': 'thyme',
  'dried thyme': 'thyme',
  'fresh rosemary': 'rosemary',
  'dried rosemary': 'rosemary',
  'fresh oregano': 'oregano',
  'dried oregano': 'oregano',
}

/**
 * The bare herb rows that hold fresh values (docs/PROJECT_SPEC.md), so a bare
 * row in the pantry is the fresh plant. `oregano`, `tarragon`, `sage` and
 * `marjoram` hold dried values and are left out: a jar of oregano is not fresh
 * oregano. A herb missing here only loses the bare → fresh cover.
 */
export const FRESH_BARE_HERBS: ReadonlySet<string> = new Set([
  'basil',
  'parsley',
  'coriander',
  'dill',
  'mint',
  'chives',
  'thyme',
  'rosemary',
])

/**
 * Every cover as `[pantry row, recipe row it covers]`: each form row covers
 * its bare row, and each fresh bare row covers its `fresh` row (HON-1567). A
 * row covers one other row only, so `dried basil` never reaches `fresh basil`.
 */
export const INGREDIENT_COVER_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ...Object.entries(INGREDIENT_FORM_COVERS),
  ...Object.entries(INGREDIENT_FORM_COVERS)
    .filter(([form, bare]) => form.startsWith('fresh ') && FRESH_BARE_HERBS.has(bare))
    .map(([fresh, bare]) => [bare, fresh] as const),
]
