/**
 * Design-rule DOM assertions for `Scenarios/*` stories.
 *
 * `docs/DESIGN.md` is prose because most of it is judgment. These five rules
 * are the part a machine can settle, so it should: an agent that nests a Card
 * inside a Card gets a failing `pnpm test-storybook:ci` run naming the rule
 * instead of a reminder it has to remember to read.
 *
 * Scope: every check walks the **subtree under** the element you pass, never
 * the element itself. That is what lets a portal-rendered scenario pass its
 * dialog element as the root — `DialogContent` is `position: fixed` by design
 * (`src/components/ui/dialog.tsx`), and the chrome hosting a scenario is not
 * part of the scenario. For an in-canvas scenario, pass `canvasElement`.
 */

export type DesignRule =
  'no-nested-cards' | 'title-scale' | 'no-sticky-content' | 'no-raw-palette' | 'no-content-shadow'

/**
 * The rule set every `Scenarios/*` story enforces. `no-raw-palette` is in it
 * because HON-608 shipped the semantic status tokens and migrated the last
 * raw palette class out of `src/**` — its acceptance criteria asked for this
 * to be switched on once scenarios existed. `no-content-shadow` is in it
 * because HON-689 removed the last shadow from controls and cards.
 */
export const SCENARIO_RULES: DesignRule[] = [
  'no-nested-cards',
  'title-scale',
  'no-sticky-content',
  'no-raw-palette',
  'no-content-shadow',
]

/** Where in `docs/DESIGN.md` each rule is written down, for the failure message. */
const RULE_SOURCE: Record<DesignRule, string> = {
  'no-nested-cards': 'docs/DESIGN.md → Composition rules → "No cards inside cards"',
  'title-scale': 'docs/DESIGN.md → Type scale → in-app titles are `Heading variant="h4"`',
  'no-sticky-content': 'docs/DESIGN.md → Composition rules → "Content is not sticky"',
  'no-raw-palette': 'docs/DESIGN.md → Color → "Never reach for a raw palette class"',
  'no-content-shadow':
    'docs/DESIGN.md → Spacing, radius, elevation → Elevation: "Only overlays cast a shadow"',
}

/**
 * The Title level (`text-xl`) is the largest heading the in-app type scale
 * allows. Measured from a probe element at check time rather than hard-coded,
 * so the limit follows the `--text-xl` value in `globals.css` (re-based in
 * HON-686) instead of keeping a second copy of it here.
 *
 * A `text-xs` probe is measured beside it because an unstyled span does not
 * read as `NaN` — it inherits the surrounding size. If the two come out equal,
 * the scale is not loaded, and the rule throws rather than enforcing whatever
 * size the probe happened to inherit.
 */
function titleLevelPx(root: HTMLElement): number {
  const measure = (className: string) => {
    const probe = document.createElement('span')
    probe.className = className
    probe.setAttribute('aria-hidden', 'true')
    root.append(probe)
    try {
      return Number.parseFloat(getComputedStyle(probe).fontSize)
    } finally {
      probe.remove()
    }
  }
  const title = measure('text-xl')
  const caption = measure('text-xs')
  if (!Number.isFinite(title) || !(title > caption)) {
    throw new Error(
      'Design rule "title-scale" could not measure the Title level: `text-xl` and `text-xs` probes compute the same font-size. Is `globals.css` loaded?',
    )
  }
  return title
}

/**
 * Tailwind palette classes that a semantic token already covers. Deliberately
 * matches the full default palette, not just the six colours currently in use:
 * the point is to catch the *next* hand-picked shade, not to re-list today's.
 * The utility prefixes must stay a superset of the must-stay-empty grep in
 * `docs/DESIGN.md` → Color, which includes `fill-` — `fill-warning` is live in
 * `PantryItem` and `PantrySection`, so `fill-amber-500` is a reachable miss.
 */
const RAW_PALETTE_CLASS =
  /\b(bg|text|border|fill)-(red|green|blue|amber|orange|yellow|emerald|slate|gray|zinc|neutral|stone|rose|pink|purple|violet|indigo|sky|cyan|teal|lime)-\d{2,3}\b/

/**
 * What counts as an overlay for `no-content-shadow`: defined by role and slot,
 * never by class, so a new overlay qualifies by being accessible rather than
 * by copying a shadow. `data-slot$="-content"` covers the Radix contents
 * (`dialog-content`, `select-content`, `dropdown-menu-sub-content`, …) and the
 * hand-rolled autocomplete popovers, which carry `autocomplete-content`.
 */
const OVERLAY_SELECTOR =
  '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], [data-slot$="-content"]'

/**
 * The overlay `element` sits in, if it is one or is inside one **below** `root`.
 * Bounded by `root` for the same reason every check skips the root itself: a
 * portal scenario passes its dialog as the root, and an unbounded `closest()`
 * would find that dialog and exempt the entire scenario.
 */
function isInOverlay(element: Element, root: HTMLElement): boolean {
  const overlay = element.closest(OVERLAY_SELECTOR)
  return overlay !== null && overlay !== root && root.contains(overlay)
}

/** Splits a computed `box-shadow` into layers, ignoring commas inside `rgb(…)`. */
function shadowLayers(boxShadow: string): string[] {
  const layers: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < boxShadow.length; i++) {
    const char = boxShadow[i]
    if (char === '(') depth++
    else if (char === ')') depth--
    else if (char === ',' && depth === 0) {
      layers.push(boxShadow.slice(start, i))
      start = i + 1
    }
  }
  layers.push(boxShadow.slice(start))
  return layers.map((layer) => layer.trim()).filter(Boolean)
}

const COLOR = /[a-z-]+\([^)]*\)|#[\da-f]{3,8}\b|\btransparent\b/i
const TRANSPARENT_COLOR = /^transparent$|[,/]\s*0(\.0+)?%?\s*\)$|^#([\da-f]{3}0|[\da-f]{6}00)$/i

/**
 * Whether a computed `box-shadow` draws a visible shadow. Two kinds of layer
 * are not elevation and are skipped: fully transparent ones, which Tailwind v4
 * composes into every element's `box-shadow` as `0 0 #0000` placeholders, and
 * spread-only ones (`0 0 0 3px`), which is how `ring-*` draws a focus ring.
 */
function castsShadow(boxShadow: string): boolean {
  if (!boxShadow || boxShadow === 'none') return false
  return shadowLayers(boxShadow).some((layer) => {
    const color = COLOR.exec(layer)?.[0] ?? ''
    if (TRANSPARENT_COLOR.test(color)) return false
    const [x = 0, y = 0, blur = 0] = (layer.replace(color, '').match(/-?\d*\.?\d+/g) ?? []).map(
      Number,
    )
    return x !== 0 || y !== 0 || blur !== 0
  })
}

/** First 120 characters of the offending element, whitespace collapsed. */
function snippet(element: Element): string {
  const html = element.outerHTML.replace(/\s+/g, ' ').trim()
  return html.length > 120 ? `${html.slice(0, 120)}…` : html
}

function violation(rule: DesignRule, detail: string, element: Element): Error {
  return new Error(
    `Design rule "${rule}" violated: ${detail}\n  See ${RULE_SOURCE[rule]}\n  Offending element: ${snippet(element)}`,
  )
}

const CHECKS: Record<DesignRule, (root: HTMLElement) => void> = {
  'no-nested-cards': (root) => {
    const nested = root.querySelector('[data-slot="card"] [data-slot="card"]')
    if (nested) {
      throw violation(
        'no-nested-cards',
        'a Card is rendered inside another Card — group with spacing and a section heading instead',
        nested,
      )
    }
  },

  // Keys on the heading tag, so a `Heading` that renders a non-heading tag
  // (`as="p" | "span" | "div"`) is invisible to it. No production callsite does
  // that today; the axe heading-order gate is what makes the tag worth trusting.
  'title-scale': (root) => {
    const maxPx = titleLevelPx(root)
    for (const heading of root.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6')) {
      const fontSize = Number.parseFloat(getComputedStyle(heading).fontSize)
      if (Number.isFinite(fontSize) && fontSize > maxPx) {
        throw violation(
          'title-scale',
          `<${heading.tagName.toLowerCase()}> renders at ${fontSize}px, above the ${maxPx}px Title level (\`text-xl\`)`,
          heading,
        )
      }
    }
  },

  'no-sticky-content': (root) => {
    for (const element of root.querySelectorAll<HTMLElement>('*')) {
      const { position } = getComputedStyle(element)
      if (position === 'sticky' || position === 'fixed') {
        throw violation(
          'no-sticky-content',
          `element is position: ${position} — the only fixed chrome is the header and the mobile tab bar`,
          element,
        )
      }
    }
  },

  'no-raw-palette': (root) => {
    for (const element of root.querySelectorAll('*')) {
      // `getAttribute` rather than `.className`: on SVG elements the property
      // is an `SVGAnimatedString`, which never matches a string regex.
      const className = element.getAttribute('class')
      const match = className && RAW_PALETTE_CLASS.exec(className)
      if (match) {
        throw violation(
          'no-raw-palette',
          `\`${match[0]}\` is a raw palette class — use a semantic token (\`success\`, \`warning\`, \`info\`, \`destructive\`)`,
          element,
        )
      }
    }
  },

  'no-content-shadow': (root) => {
    for (const element of root.querySelectorAll('*')) {
      if (isInOverlay(element, root)) continue
      const { boxShadow } = getComputedStyle(element)
      if (castsShadow(boxShadow)) {
        throw violation(
          'no-content-shadow',
          `element casts a shadow (\`${boxShadow}\`) outside an overlay — the border is the edge of a control or card`,
          element,
        )
      }
    }
  },
}

/**
 * Asserts the mechanical `docs/DESIGN.md` rules against a rendered scenario.
 * Throws on the first violation, naming the rule, the DESIGN.md section, and
 * the offending element.
 *
 * @param canvasElement Root to check. Its **descendants** are checked, not
 *   itself — pass `canvasElement` for an in-canvas scenario, or the portal
 *   root (e.g. the `[role="dialog"]` element) for one that renders through a
 *   Radix portal.
 * @param rules Which rules to enforce. Scenario stories enable all five.
 */
export async function assertDesignRules(
  canvasElement: HTMLElement,
  rules: DesignRule[],
): Promise<void> {
  for (const rule of rules) {
    const check = CHECKS[rule]
    if (!check) {
      throw new Error(
        `Unknown design rule "${rule}". Known rules: ${Object.keys(CHECKS).join(', ')}.`,
      )
    }
    check(canvasElement)
  }
}
