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
      options: [
        'default',
        'destructive',
        'outline',
        'secondary',
        'ghost',
        'quiet',
        'quiet-destructive',
        'link',
        'quiet-link',
      ],
    },
    size: {
      control: 'select',
      options: [
        'default',
        'sm',
        'lg',
        'icon',
        'icon-xs',
        'icon-sm',
        'icon-lg',
        'icon-lg-to-lg',
        'inline',
      ],
    },
    shape: { control: 'select', options: ['default', 'pill'] },
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

export const Quiet: Story = {
  args: { variant: 'quiet', size: 'sm', children: 'Copy list' },
}

export const QuietDestructive: Story = {
  args: {
    variant: 'quiet-destructive',
    size: 'icon-sm',
    'aria-label': 'Remove',
    children: <Trash2 />,
  },
}

export const Link: Story = {
  args: { variant: 'link' },
}

// `inline` drops the control box so a link sits on the line of the sentence
// around it.
export const InlineLink: Story = {
  render: () => (
    <p className="text-muted-foreground text-sm">
      We use essential cookies only.{' '}
      <Button variant="link" size="inline">
        Cookie settings
      </Button>
    </p>
  ),
  play: async ({ canvasElement }) => {
    const button = within(canvasElement).getByRole('button', { name: 'Cookie settings' })
    await expect(getComputedStyle(button).paddingLeft).toBe('0px')
    await expect(button.getBoundingClientRect().height).toBeLessThan(32)
  },
}

// `quiet-link` sits in a row of muted text links — the footer's cookie
// settings beside its privacy and terms links — and must not outrank them.
export const QuietLink: Story = {
  render: () => (
    <div className="flex gap-4">
      <a href="#privacy" className="text-muted-foreground text-sm hover:underline">
        Privacy policy
      </a>
      <Button variant="quiet-link" size="inline">
        Cookie settings
      </Button>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const link = getComputedStyle(canvas.getByRole('link', { name: 'Privacy policy' }))
    const button = getComputedStyle(canvas.getByRole('button', { name: 'Cookie settings' }))
    await expect(button.color).toBe(link.color)
    await expect(button.fontSize).toBe(link.fontSize)
    await expect(button.fontWeight).toBe(link.fontWeight)
  },
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

// A pending action: looks like `Disabled` but stays focusable, so a dialog it
// opened can hand focus back to it on close. The handler must guard itself —
// `pointer-events-none` stops the pointer, not Enter or Space (HON-803).
export const AriaDisabled: Story = {
  args: { 'aria-disabled': true, children: 'Adding…' },
  play: async ({ canvasElement }) => {
    const button = within(canvasElement).getByRole('button', { name: 'Adding…' })
    await expect(button).toHaveAttribute('aria-disabled', 'true')
    await expect(getComputedStyle(button).pointerEvents).toBe('none')
    button.focus()
    await expect(button).toHaveFocus()
  },
}

export const AllVariants: Story = {
  render: () => (
    <div className="flex flex-wrap gap-3">
      <Button>Default</Button>
      <Button variant="destructive">Destructive</Button>
      <Button variant="outline">Outline</Button>
      <Button variant="secondary">Secondary</Button>
      <Button variant="ghost">Ghost</Button>
      <Button variant="quiet">Quiet</Button>
      <Button variant="quiet-destructive">Quiet destructive</Button>
      <Button variant="link">Link</Button>
      <Button variant="quiet-link">Quiet link</Button>
    </div>
  ),
}

export const AllSizes: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-3">
      <Button size="sm">Small</Button>
      <Button size="default">Default</Button>
      <Button size="lg">Large</Button>
      <Button size="icon-xs" aria-label="Add">
        <Plus />
      </Button>
      <Button size="icon-sm" aria-label="Add">
        <Plus />
      </Button>
      <Button size="icon" aria-label="Add">
        <Plus />
      </Button>
      <Button size="icon-lg" aria-label="Add">
        <Plus />
      </Button>
      <Button size="icon-lg-to-lg" aria-label="Add a meal">
        <Plus />
        <span className="hidden lg:inline">Add</span>
      </Button>
    </div>
  ),
}

/**
 * `icon-lg-to-lg` (HON-981): the icon alone in an `icon-lg` box below `lg`,
 * and the icon with its label from `lg`. The `aria-label` contains the label.
 */
function IconToLabel() {
  return (
    <Button variant="ghost" size="icon-lg-to-lg" aria-label="Add a meal">
      <Plus />
      <span className="hidden lg:inline">Add</span>
    </Button>
  )
}

export const IconToLabelPhone: Story = {
  name: 'Icon to label (phone)',
  globals: { viewport: { value: 'mobileIphone', isRotated: false } },
  render: () => <IconToLabel />,
  play: async ({ canvasElement }) => {
    const button = within(canvasElement).getByRole('button', { name: 'Add a meal' })
    const box = button.getBoundingClientRect()
    await expect(box.width).toBe(48)
    await expect(box.height).toBe(48)
    await expect(within(button).getByText('Add')).not.toBeVisible()
  },
}

export const IconToLabelDesktop: Story = {
  name: 'Icon to label (desktop)',
  globals: { viewport: { value: 'laptop', isRotated: false } },
  render: () => <IconToLabel />,
  play: async ({ canvasElement }) => {
    const button = within(canvasElement).getByRole('button', { name: 'Add a meal' })
    const box = button.getBoundingClientRect()
    await expect(box.height).toBe(44)
    await expect(box.width).toBeGreaterThan(box.height)
    await expect(within(button).getByText('Add')).toBeVisible()
  },
}

/**
 * `shape="pill"` for controls inside a rounded-full surface, the header's
 * pills: the filled sign-up, the ghost sign-in beside it, and the ghost icon
 * discs. Wins over the `rounded-md` that `sm` restates.
 */
export const Pill: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-1">
      <Button variant="ghost" size="sm" shape="pill">
        Sign in
      </Button>
      <Button size="sm" shape="pill">
        Sign up
      </Button>
      <Button variant="ghost" size="icon" shape="pill" aria-label="Add">
        <Plus />
      </Button>
    </div>
  ),
  play: async ({ canvasElement }) => {
    for (const button of within(canvasElement).getAllByRole('button')) {
      await expect(button).toHaveClass('rounded-full')
      await expect(button).not.toHaveClass('rounded-md')
    }
  },
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
