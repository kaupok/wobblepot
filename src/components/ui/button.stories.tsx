import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { Plus, Trash2 } from 'lucide-react'
import { expect, within } from 'storybook/test'
import { Button } from './button'

const meta = {
  title: 'UI/Button',
  component: Button,
  tags: ['autodocs'],
  argTypes: {
    variant: {
      control: 'select',
      options: ['default', 'destructive', 'outline', 'secondary', 'ghost', 'link'],
    },
    size: {
      control: 'select',
      options: ['default', 'sm', 'lg', 'icon', 'icon-sm', 'icon-lg'],
    },
    disabled: { control: 'boolean' },
  },
  args: {
    children: 'Button',
  },
} satisfies Meta<typeof Button>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const Destructive: Story = {
  args: { variant: 'destructive' },
}

export const Outline: Story = {
  args: { variant: 'outline' },
}

export const Secondary: Story = {
  args: { variant: 'secondary' },
}

export const Ghost: Story = {
  args: { variant: 'ghost' },
}

export const Link: Story = {
  args: { variant: 'link' },
}

export const Small: Story = {
  args: { size: 'sm' },
}

export const Large: Story = {
  args: { size: 'lg' },
}

export const WithIcon: Story = {
  args: {
    children: (
      <>
        <Plus />
        Add meal
      </>
    ),
  },
}

export const IconOnly: Story = {
  args: {
    size: 'icon',
    'aria-label': 'Delete',
    children: <Trash2 />,
  },
}

export const Disabled: Story = {
  args: { disabled: true },
}

export const AllVariants: Story = {
  render: () => (
    <div className="flex flex-wrap gap-3">
      <Button>Default</Button>
      <Button variant="destructive">Destructive</Button>
      <Button variant="outline">Outline</Button>
      <Button variant="secondary">Secondary</Button>
      <Button variant="ghost">Ghost</Button>
      <Button variant="link">Link</Button>
    </div>
  ),
}

export const AllSizes: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-3">
      <Button size="sm">Small</Button>
      <Button size="default">Default</Button>
      <Button size="lg">Large</Button>
      <Button size="icon-sm" aria-label="Add">
        <Plus />
      </Button>
      <Button size="icon" aria-label="Add">
        <Plus />
      </Button>
      <Button size="icon-lg" aria-label="Add">
        <Plus />
      </Button>
    </div>
  ),
}

// Press feedback (docs/DESIGN.md → Motion): every variant scales to 0.97 on
// `:active` except `link`. A synthetic `userEvent` press cannot put an element
// into `:active` — only real user-agent input does — so the play function
// resolves the `:active` rules the loaded stylesheets apply to each button and
// reads the computed `scale` they produce. That proves the compiled CSS, not
// just the class string `button.test.tsx` already covers.
export const PressScale: Story = {
  render: () => (
    <div className="flex flex-wrap gap-3">
      <Button>Default</Button>
      <Button variant="destructive">Destructive</Button>
      <Button variant="outline">Outline</Button>
      <Button variant="secondary">Secondary</Button>
      <Button variant="ghost">Ghost</Button>
      <Button variant="link">Link</Button>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)

    for (const name of ['Default', 'Destructive', 'Outline', 'Secondary', 'Ghost']) {
      const button = canvas.getByRole('button', { name })
      expect(window.getComputedStyle(button).transitionProperty).toContain('scale')
      expect(pressedScale(button)).toBe('0.97')
    }

    expect(pressedScale(canvas.getByRole('button', { name: 'Link' }))).toBe('1')
  },
}

// Returns the computed `scale` an element would have while pressed, by applying
// the declarations of every stylesheet rule that matches it under `:active`
// inline (transitions off, so the value is final, not mid-animation), reading
// the result, and restoring the element. Handles nested rules, since Tailwind's
// dev output can emit `&:active` inside the utility's rule.
function pressedScale(element: HTMLElement): string {
  const declarations: string[] = []

  const visit = (rules: CSSRuleList, parent: string | null) => {
    for (const rule of Array.from(rules)) {
      if (rule instanceof CSSStyleRule) {
        const selector = parent
          ? rule.selectorText.includes('&')
            ? rule.selectorText.replaceAll('&', `:is(${parent})`)
            : `:is(${parent}) ${rule.selectorText}`
          : rule.selectorText
        if (/:active\b/.test(selector)) {
          try {
            if (element.matches(selector.replace(/:active\b/g, ''))) {
              declarations.push(rule.style.cssText)
            }
          } catch {
            // A selector `matches` cannot parse once `:active` is stripped is not ours.
          }
        }
        if (rule.cssRules.length > 0) visit(rule.cssRules, selector)
      } else if (rule instanceof CSSMediaRule) {
        if (window.matchMedia(rule.conditionText).matches) visit(rule.cssRules, parent)
      } else if (rule instanceof CSSLayerBlockRule || rule instanceof CSSSupportsRule) {
        visit(rule.cssRules, parent)
      }
    }
  }

  for (const sheet of Array.from(document.styleSheets)) {
    try {
      visit(sheet.cssRules, null)
    } catch {
      // Cross-origin stylesheets throw on `cssRules`; they carry no app styles.
    }
  }

  const original = element.getAttribute('style')
  element.setAttribute('style', `${declarations.join(' ')} transition: none;`)
  const scale = window.getComputedStyle(element).scale
  if (original === null) element.removeAttribute('style')
  else element.setAttribute('style', original)
  return scale
}

// Sizes are the only thing that branches at `md:` — every variant renders
// identically at both viewports. Mobile (the default viewport) is 44/48/32px;
// this story is the 40/44/32px half of the same grid.
export const Desktop: Story = {
  globals: {
    viewport: { value: 'desktop', isRotated: false },
  },
  render: AllSizes.render,
}
