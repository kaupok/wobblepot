import { describe, it, expect, afterEach } from 'vitest'
import { assertDesignRules, type DesignRule } from './design-rules'

const ALL_RULES: DesignRule[] = [
  'no-nested-cards',
  'title-scale',
  'no-sticky-content',
  'no-raw-palette',
  'no-content-shadow',
]

/**
 * Stands in for `globals.css`: `title-scale` measures a `text-xl` probe to find
 * the Title level (against a `text-xs` probe, to tell a loaded scale from an
 * inherited size), and jsdom resolves stylesheet rules through
 * `getComputedStyle` but has no Tailwind. 22px is the re-based `--text-xl`
 * (HON-686); `UI/Tokens` → `TypeScale` checks the real value in Chromium.
 */
const TITLE_LEVEL_STYLE = '<style>.text-xl { font-size: 22px } .text-xs { font-size: 14px }</style>'

/**
 * Renders `html` into a detached-but-attached root. Styles come from inline
 * `style` attributes because jsdom resolves those through `getComputedStyle`
 * but does not resolve Tailwind classes — the real Tailwind values are covered
 * by the `Scenarios/*` stories running in Chromium.
 */
function render(html: string, { titleLevel = true } = {}): HTMLElement {
  const root = document.createElement('div')
  root.innerHTML = html
  document.body.append(root)
  if (titleLevel) document.head.insertAdjacentHTML('beforeend', TITLE_LEVEL_STYLE)
  return root
}

afterEach(() => {
  document.body.innerHTML = ''
  document.head.innerHTML = ''
})

describe('assertDesignRules', () => {
  it('passes a clean tree with every rule enabled', async () => {
    const root = render(`
      <div data-slot="card">
        <h4 style="font-size: 22px">Shopping list</h4>
        <p class="text-muted-foreground">3 items</p>
        <span class="text-success">Available</span>
      </div>
    `)
    await expect(assertDesignRules(root, ALL_RULES)).resolves.toBeUndefined()
  })

  it('passes when the rule list is empty, even on a violating tree', async () => {
    const root = render('<div data-slot="card"><div data-slot="card"></div></div>')
    await expect(assertDesignRules(root, [])).resolves.toBeUndefined()
  })

  it('only runs the rules it is given', async () => {
    const root = render('<div data-slot="card"><div data-slot="card"></div></div>')
    await expect(assertDesignRules(root, ['title-scale'])).resolves.toBeUndefined()
  })

  it('throws on an unknown rule name rather than passing silently', async () => {
    const root = render('<div></div>')
    await expect(assertDesignRules(root, ['not-a-rule' as DesignRule])).rejects.toThrow(
      /Unknown design rule "not-a-rule"/,
    )
  })

  describe('no-nested-cards', () => {
    it('fails when a Card is rendered inside a Card', async () => {
      const root = render(
        '<div data-slot="card"><div data-slot="card" id="inner">Nested</div></div>',
      )
      await expect(assertDesignRules(root, ['no-nested-cards'])).rejects.toThrow(
        /Design rule "no-nested-cards" violated/,
      )
    })

    it('names the DESIGN.md section and shows the offending element', async () => {
      const root = render(
        '<div data-slot="card"><div data-slot="card" id="inner">Nested</div></div>',
      )
      await expect(assertDesignRules(root, ['no-nested-cards'])).rejects.toThrow(
        /No cards inside cards[\s\S]*id="inner"/,
      )
    })

    it('allows sibling cards', async () => {
      const root = render('<div data-slot="card"></div><div data-slot="card"></div>')
      await expect(assertDesignRules(root, ['no-nested-cards'])).resolves.toBeUndefined()
    })
  })

  describe('title-scale', () => {
    it('fails a heading above the Title level', async () => {
      const root = render('<h2 style="font-size: 30px">Page title</h2>')
      await expect(assertDesignRules(root, ['title-scale'])).rejects.toThrow(
        /Design rule "title-scale" violated: <h2> renders at 30px, above the 22px Title level/,
      )
    })

    it('fails a `text-2xl` heading, one step above the Title level', async () => {
      const root = render('<h2 style="font-size: 24px">Page title</h2>')
      await expect(assertDesignRules(root, ['title-scale'])).rejects.toThrow(/<h2> renders at 24px/)
    })

    it('allows a heading at exactly the Title level', async () => {
      const root = render('<h2 style="font-size: 22px">Page title</h2>')
      await expect(assertDesignRules(root, ['title-scale'])).resolves.toBeUndefined()
    })

    it('reads the limit from the `text-xl` probe rather than a constant', async () => {
      const root = render('<h2 style="font-size: 22px">Page title</h2>', { titleLevel: false })
      document.head.insertAdjacentHTML(
        'beforeend',
        '<style>.text-xl { font-size: 20px } .text-xs { font-size: 14px }</style>',
      )
      await expect(assertDesignRules(root, ['title-scale'])).rejects.toThrow(
        /renders at 22px, above the 20px Title level/,
      )
    })

    it('throws rather than passing when the Title level cannot be measured', async () => {
      const root = render('<h2 style="font-size: 30px">Page title</h2>', { titleLevel: false })
      await expect(assertDesignRules(root, ['title-scale'])).rejects.toThrow(
        /could not measure the Title level/,
      )
    })

    it('removes the probe after measuring', async () => {
      const root = render('<h4 style="font-size: 22px">Fine</h4>')
      await assertDesignRules(root, ['title-scale'])
      expect(root.querySelector('.text-xl, .text-xs')).toBeNull()
    })

    it('checks every heading level, not just the first', async () => {
      const root = render(
        '<h4 style="font-size: 22px">Fine</h4><h5 style="font-size: 24px">Too big</h5>',
      )
      await expect(assertDesignRules(root, ['title-scale'])).rejects.toThrow(/<h5> renders at 24px/)
    })
  })

  describe('no-sticky-content', () => {
    it.each(['sticky', 'fixed'])('fails an element with position: %s', async (position) => {
      const root = render(`<div style="position: ${position}">Action bar</div>`)
      await expect(assertDesignRules(root, ['no-sticky-content'])).rejects.toThrow(
        new RegExp(`Design rule "no-sticky-content" violated: element is position: ${position}`),
      )
    })

    it('allows relative and absolute positioning', async () => {
      const root = render(
        '<div style="position: relative"><span style="position: absolute">Badge</span></div>',
      )
      await expect(assertDesignRules(root, ['no-sticky-content'])).resolves.toBeUndefined()
    })

    it('ignores the root element itself, so a portal root can be passed', async () => {
      const root = render('<span>Dialog body</span>')
      root.style.position = 'fixed'
      await expect(assertDesignRules(root, ['no-sticky-content'])).resolves.toBeUndefined()
    })
  })

  describe('no-raw-palette', () => {
    it('fails a raw palette class and quotes it', async () => {
      const root = render('<span class="text-amber-700 font-medium">Missing</span>')
      await expect(assertDesignRules(root, ['no-raw-palette'])).rejects.toThrow(
        /Design rule "no-raw-palette" violated: `text-amber-700` is a raw palette class/,
      )
    })

    it('covers `fill-`, which the docs/DESIGN.md grep also lists', async () => {
      const root = render('<svg class="fill-amber-500"><title>Staple</title></svg>')
      await expect(assertDesignRules(root, ['no-raw-palette'])).rejects.toThrow(
        /`fill-amber-500` is a raw palette class/,
      )
    })

    it('allows semantic tokens', async () => {
      const root = render(
        '<span class="text-success bg-success-muted border-warning/30 fill-warning">Available</span>',
      )
      await expect(assertDesignRules(root, ['no-raw-palette'])).resolves.toBeUndefined()
    })

    it('allows sizing and spacing classes that share the colour prefixes', async () => {
      const root = render('<span class="text-sm border-2 bg-card">Item</span>')
      await expect(assertDesignRules(root, ['no-raw-palette'])).resolves.toBeUndefined()
    })

    it('reads the class attribute, so an SVG child is still checked', async () => {
      const root = render('<svg class="text-green-600"><title>Check</title></svg>')
      await expect(assertDesignRules(root, ['no-raw-palette'])).rejects.toThrow(
        /`text-green-600` is a raw palette class/,
      )
    })
  })
  describe('no-content-shadow', () => {
    /** Tailwind's `shadow-sm`, as jsdom has no Tailwind to resolve the class. */
    const SHADOW_SM = '<style>.shadow-sm { box-shadow: 0 1px 3px 0 rgb(0 0 0 / 0.1) }</style>'

    it('fails a `shadow-sm` element inside a scenario', async () => {
      const root = render(`${SHADOW_SM}<div class="shadow-sm" id="card">Card</div>`)
      await expect(assertDesignRules(root, ['no-content-shadow'])).rejects.toThrow(
        /Design rule "no-content-shadow" violated[\s\S]*Only overlays cast a shadow[\s\S]*id="card"/,
      )
    })

    it.each([
      ['role="dialog"'],
      ['role="alertdialog"'],
      ['role="menu"'],
      ['role="listbox"'],
      ['data-slot="select-content"'],
      ['data-slot="autocomplete-content"'],
    ])('allows a shadow on and inside an overlay marked %s', async (marker) => {
      const root = render(
        `${SHADOW_SM}<div ${marker} class="shadow-sm"><span class="shadow-sm">Option</span></div>`,
      )
      await expect(assertDesignRules(root, ['no-content-shadow'])).resolves.toBeUndefined()
    })

    it('does not exempt the scenario root, so a dialog scenario is still checked', async () => {
      const root = render(`${SHADOW_SM}<div class="shadow-sm">Card in a dialog</div>`)
      root.setAttribute('role', 'dialog')
      await expect(assertDesignRules(root, ['no-content-shadow'])).rejects.toThrow(
        /no-content-shadow/,
      )
    })

    it('allows a spread-only focus ring', async () => {
      const root = render('<input style="box-shadow: 0 0 0 3px rgb(0 0 0 / 0.5)">')
      await expect(assertDesignRules(root, ['no-content-shadow'])).resolves.toBeUndefined()
    })

    it('allows the transparent layers Tailwind composes into every box-shadow', async () => {
      const root = render(
        '<div style="box-shadow: rgba(0, 0, 0, 0) 0px 1px 2px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px">Row</div>',
      )
      await expect(assertDesignRules(root, ['no-content-shadow'])).resolves.toBeUndefined()
    })

    it('fails when only one of several layers is visible', async () => {
      const root = render(
        '<div style="box-shadow: rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0.05) 0px 1px 2px 0px">Input</div>',
      )
      await expect(assertDesignRules(root, ['no-content-shadow'])).rejects.toThrow(
        /no-content-shadow/,
      )
    })
  })
})
