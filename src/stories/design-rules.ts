/**
 * Design-rule DOM assertions for `Scenarios/*` stories.
 *
 * `docs/DESIGN.md` is prose because most of it is judgment. These four rules
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

export type DesignRule = 'no-nested-cards' | 'title-scale' | 'no-sticky-content' | 'no-raw-palette'

/**
 * The rule set every `Scenarios/*` story enforces. `no-raw-palette` is in it
 * because HON-608 shipped the semantic status tokens and migrated the last
 * raw palette class out of `src/**` — its acceptance criteria asked for this
 * to be switched on once scenarios existed.
 */
export const SCENARIO_RULES: DesignRule[] = [
  'no-nested-cards',
  'title-scale',
  'no-sticky-content',
  'no-raw-palette',
]

/** Where in `docs/DESIGN.md` each rule is written down, for the failure message. */
const RULE_SOURCE: Record<DesignRule, string> = {
  'no-nested-cards': 'docs/DESIGN.md → Composition rules → "No cards inside cards"',
  'title-scale': 'docs/DESIGN.md → Type scale → in-app titles are `Heading variant="h4"`',
  'no-sticky-content': 'docs/DESIGN.md → Composition rules → "Content is not sticky"',
  'no-raw-palette': 'docs/DESIGN.md → Color → "Never reach for a raw palette class"',
}

/** The Title level (`text-xl`) is the largest heading the in-app type scale allows. */
const MAX_HEADING_FONT_SIZE_PX = 20

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
    for (const heading of root.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6')) {
      const fontSize = Number.parseFloat(getComputedStyle(heading).fontSize)
      if (Number.isFinite(fontSize) && fontSize > MAX_HEADING_FONT_SIZE_PX) {
        throw violation(
          'title-scale',
          `<${heading.tagName.toLowerCase()}> renders at ${fontSize}px, above the ${MAX_HEADING_FONT_SIZE_PX}px Title level`,
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
 * @param rules Which rules to enforce. Scenario stories enable all four.
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
