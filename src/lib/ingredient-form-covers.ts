/**
 * Herb rows whose pantry stock covers a recipe line for the bare herb (HON-1558).
 *
 * Recipes name the bare row (`basil`), which holds the form shops sell most.
 * A household names the form of the jar or bunch it has (`dried basil`). For
 * the shopping list, either form at home satisfies a bare line; a `fresh basil`
 * or `dried basil` line is satisfied only by its own row.
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
