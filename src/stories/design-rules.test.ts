import { describe, it, expect, afterEach } from 'vitest'
import { assertDesignRules, type DesignRule } from './design-rules'

const ALL_RULES: DesignRule[] = [
  'no-nested-cards',
  'title-scale',
  'no-sticky-content',
  'no-raw-palette',
]

/**
 * Renders `html` into a detached-but-attached root. Styles come from inline
 * `style` attributes because jsdom resolves those through `getComputedStyle`
 * but does not resolve Tailwind classes — the real Tailwind values are covered
 * by the `Scenarios/*` stories running in Chromium.
 */
function render(html: string): HTMLElement {
  const root = document.createElement('div')
  root.innerHTML = html
  document.body.append(root)
  return root
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('assertDesignRules', () => {
  it('passes a clean tree with every rule enabled', async () => {
    const root = render(`
      <div data-slot="card">
        <h4 style="font-size: 20px">Shopping list</h4>
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
    it('fails a heading above the 20px Title level', async () => {
      const root = render('<h2 style="font-size: 30px">Page title</h2>')
      await expect(assertDesignRules(root, ['title-scale'])).rejects.toThrow(
        /Design rule "title-scale" violated: <h2> renders at 30px/,
      )
    })

    it('allows a heading at exactly 20px', async () => {
      const root = render('<h2 style="font-size: 20px">Page title</h2>')
      await expect(assertDesignRules(root, ['title-scale'])).resolves.toBeUndefined()
    })

    it('checks every heading level, not just the first', async () => {
      const root = render(
        '<h4 style="font-size: 20px">Fine</h4><h5 style="font-size: 24px">Too big</h5>',
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
})
