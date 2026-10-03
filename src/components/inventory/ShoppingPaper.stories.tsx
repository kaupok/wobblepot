import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, within } from 'storybook/test'
import { Body, Heading } from '@/components/ui/typography'
import { ShoppingPaper } from './ShoppingPaper'
import type { InventoryView } from './InventoryPage'

/**
 * The page shell `InventoryPage` renders, with placeholder columns: the paper
 * is a fixed layer, so it only means something beside the two halves it
 * divides.
 */
function SplitPage({ view }: { view: InventoryView }) {
  return (
    <div className="w-full px-4 py-8" data-testid="split-page">
      <ShoppingPaper view={view} />
      <div className="grid gap-8 md:grid-cols-2">
        <div className={view === 'pantry' ? undefined : 'hidden md:block'}>
          <Heading variant="h4" as="h2">
            Your pantry
          </Heading>
          <Body variant="muted">On the neutral page background.</Body>
        </div>
        <div className={view === 'shopping' ? undefined : 'hidden md:block'} data-surface="note">
          <Heading variant="h4" as="h2">
            Shopping list
          </Heading>
          <Body variant="muted">On the shopping note&apos;s paper.</Body>
        </div>
      </div>
    </div>
  )
}

/**
 * From `md` the paper's left edge is the centre of the column gap and its
 * right edge the page's (the reserved scrollbar gutter stays the browser's);
 * below `md` it covers the screen on `/shopping` and is not drawn on
 * `/pantry`. Measured against the rendered columns rather than a viewport
 * constant, so it holds at whatever width the run has.
 */
async function assertSplit(canvasElement: HTMLElement, view: InventoryView) {
  const paper = within(canvasElement.ownerDocument.body).getByTestId('shopping-paper')
  const shell = canvasElement.querySelector<HTMLElement>('[data-testid="split-page"]')!
  const [pantry, shopping] = [...shell.querySelectorAll(':scope > .grid > div')].map((column) =>
    column.getBoundingClientRect(),
  )
  const page = shell.getBoundingClientRect()
  const rect = paper.getBoundingClientRect()
  const desktop = pantry!.width > 0 && shopping!.width > 0

  if (!desktop && view === 'pantry') {
    expect(getComputedStyle(paper).display).toBe('none')
    return
  }
  const left = desktop ? (pantry!.right + shopping!.left) / 2 : page.left
  expect(rect.left).toBeCloseTo(left, 0)
  expect(rect.right).toBeCloseTo(page.right, 0)
  expect(rect.top).toBe(0)
  expect(rect.bottom).toBe(canvasElement.ownerDocument.defaultView!.innerHeight)
  // A flat edge: no gradient, shadow or border on the split.
  const style = getComputedStyle(paper)
  expect(style.backgroundImage).toBe('none')
  expect(style.boxShadow).toBe('none')
  expect(style.borderLeftWidth).toBe('0px')
}

const meta = {
  title: 'Feature/Inventory/ShoppingPaper',
  component: SplitPage,
  tags: ['autodocs'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          "The shopping note's paper (`[data-surface='note']`) behind the list half of Pantry & shopping (HON-1012). From `md` up it is the right half of the viewport, top to bottom, with a flat edge at the centre of the column gap; on a phone it covers `/shopping` and is absent on `/pantry`. The list column carries the same scope, so everything in it takes the note's tokens.",
      },
    },
  },
  args: { view: 'shopping' },
} satisfies Meta<typeof SplitPage>

export default meta
type Story = StoryObj<typeof meta>

/** `md` exactly: the narrowest width that shows both halves. */
export const Tablet: Story = {
  globals: { viewport: { value: 'tabletPortrait', isRotated: false } },
  play: async ({ canvasElement }) => assertSplit(canvasElement, 'shopping'),
}

export const Desktop: Story = {
  globals: { viewport: { value: 'desktop', isRotated: false } },
  play: async ({ canvasElement }) => assertSplit(canvasElement, 'shopping'),
}

export const Laptop: Story = {
  globals: { viewport: { value: 'laptop', isRotated: false } },
  play: async ({ canvasElement }) => assertSplit(canvasElement, 'shopping'),
}

export const PhoneShopping: Story = {
  globals: { viewport: { value: 'mobileIphone', isRotated: false } },
  play: async ({ canvasElement }) => assertSplit(canvasElement, 'shopping'),
}

export const PhonePantry: Story = {
  args: { view: 'pantry' },
  globals: { viewport: { value: 'mobileIphone', isRotated: false } },
  play: async ({ canvasElement }) => assertSplit(canvasElement, 'pantry'),
}

/** The note's dark sheet, so the a11y gate measures both themes. */
export const Dark: Story = {
  globals: { theme: 'dark', viewport: { value: 'tabletPortrait', isRotated: false } },
  play: async ({ canvasElement }) => assertSplit(canvasElement, 'shopping'),
}
