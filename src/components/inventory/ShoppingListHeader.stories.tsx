import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { getRouter } from '@storybook/nextjs-vite/navigation.mock'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import { useTranslations } from 'next-intl'
import { Check, Copy, Trash2 } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Body } from '@/components/ui/typography'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ShoppingListHeader } from './ShoppingListHeader'
import { WINDOW_STORAGE_KEY } from './use-shopping-window'

interface SummaryProps {
  windowDays: number
  total: number
  purchased: number
}

/** The summary line `ShoppingSection` passes: window · item count · purchased tail. */
function Summary({ windowDays, total, purchased }: SummaryProps) {
  const tShopping = useTranslations('shopping')
  return (
    <>
      {windowDays === 14 ? tShopping('windowNext14') : tShopping('windowNext7')} ·{' '}
      {tShopping('itemCount', { count: total })} ·{' '}
      {tShopping('purchasedTail', { count: purchased })}
    </>
  )
}

/** The three controls `ShoppingSection` passes as `children`, at their busiest. */
function ListControls() {
  const tShopping = useTranslations('shopping')
  const tSort = useTranslations('shopping.sort')
  return (
    <>
      <Button variant="ghost" size="sm" className="text-muted-foreground">
        <Copy className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
        {tShopping('copyList')}
      </Button>
      <Button variant="ghost" size="sm" className="text-muted-foreground">
        <Trash2 className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
        {tShopping('clearChecked')}
      </Button>
      <Select defaultValue="category">
        <SelectTrigger size="sm" className="w-[150px]" aria-label={tShopping('ariaSort')}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="category">{tSort('category')}</SelectItem>
          <SelectItem value="urgency">{tSort('urgency')}</SelectItem>
          <SelectItem value="alphabetical">{tSort('alphabetical')}</SelectItem>
        </SelectContent>
      </Select>
    </>
  )
}

const meta = {
  title: 'Feature/Inventory/ShoppingListHeader',
  component: ShoppingListHeader,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          "The `CardHeader` both `/shopping` branches share. It carries the page title, the populated list's summary line, whatever controls that branch owns, and — always — the 7/14-day window picker. Putting the picker here is the point: before HON-624 it lived only in the `nothing-needed` empty state, so widening to 14 days surfaced items, swapped in `ShoppingSection`, and took the only control that could narrow it back off the screen.",
      },
    },
  },
  // The picker persists before navigating, so a played story would otherwise
  // change what every later story mounts with.
  beforeEach: () => () => localStorage.removeItem(WINDOW_STORAGE_KEY),
  args: {
    windowDays: 7,
  },
  // Every story renders inside a Card — the header is CardHeader contents, not
  // a standalone block, and `pt-0` on the body is what closes the gap.
  decorators: [
    (Story) => (
      <Card className="w-full">
        <Story />
        <CardContent className="pt-0">
          <Body variant="muted">Card body</Body>
        </CardContent>
      </Card>
    ),
  ],
} satisfies Meta<typeof ShoppingListHeader>

export default meta
type Story = StoryObj<typeof meta>

export const EmptyState: Story = {
  parameters: {
    docs: {
      description: {
        story:
          "The shape `ShoppingEmptyState` renders for its two list-shaped variants: title and picker only. With no summary the row centres, so the picker sits on the title's optical line rather than above it.",
      },
    },
  },
}

export const Populated: Story = {
  args: {
    summary: <Summary windowDays={7} total={12} purchased={3} />,
    children: <ListControls />,
  },
  parameters: {
    docs: {
      description: {
        story:
          "`ShoppingSection`'s header at its busiest — all three list controls plus the window picker. None of them can shrink (`Button`'s cva base is `shrink-0 whitespace-nowrap`, the sort select is `w-[150px]`, this one `w-[100px]`), so at the default 390px viewport the row wraps rather than overflowing the card. This is the case the wrap exists for.",
      },
    },
  },
}

export const PopulatedFourteenDays: Story = {
  args: {
    windowDays: 14,
    summary: <Summary windowDays={14} total={19} purchased={3} />,
    children: <ListControls />,
  },
  // `useShoppingWindow` reconciles the stored preference against the prop on
  // mount and pushes when they disagree. Storybook's app-router `push` is a spy
  // and cannot navigate, so an unseeded story would sit in a state the real app
  // never holds: a 14-day header with a pending redirect to `?days=7`.
  beforeEach: () => {
    localStorage.setItem(WINDOW_STORAGE_KEY, '14')
    return () => localStorage.removeItem(WINDOW_STORAGE_KEY)
  },
  parameters: {
    docs: {
      description: {
        story:
          'The wider window. The picker and the summary line read from the same `windowDays`, so they can never disagree about which window is on screen.',
      },
    },
  },
}

export const WindowPickerSwitchesWindow: Story = {
  parameters: {
    docs: {
      description: {
        story:
          'Behavioural contract of the picker on the empty state: choosing "14 days" persists the preference under `shopping-list-window-days` and routes to `/shopping?days=14`. The persistence is what makes the choice survive the navigation — the new page reads it back on mount.',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('combobox', { name: /time window/i }))

    // Radix portals `SelectContent` outside the canvas.
    const body = within(document.body)
    await userEvent.click(await body.findByRole('option', { name: '14 days' }))

    // Radix keeps the listbox mounted through its exit animation and leaves an
    // `aria-hidden` wrapper in place until it finishes. The a11y gate runs in an
    // `afterEach`, so returning early makes axe audit a half-closed dropdown.
    await waitFor(() => {
      expect(document.querySelectorAll('[role="listbox"]').length).toBe(0)
    })

    expect(localStorage.getItem(WINDOW_STORAGE_KEY)).toBe('14')
    expect(getRouter().push).toHaveBeenCalledWith('/shopping?days=14')
  },
}

export const WindowPickerNarrowsWithItemsOnScreen: Story = {
  args: {
    windowDays: 14,
    summary: <Summary windowDays={14} total={19} purchased={3} />,
    children: <ListControls />,
  },
  // Seeded to 14 so the mount reconcile agrees with the prop and the only
  // `push` the assertion can see is the one the picker fires.
  beforeEach: () => {
    localStorage.setItem(WINDOW_STORAGE_KEY, '14')
    return () => localStorage.removeItem(WINDOW_STORAGE_KEY)
  },
  parameters: {
    docs: {
      description: {
        story:
          'The regression HON-624 closes: narrowing 14 → 7 from a header that has items under it. This path had no control at all before the picker moved into the shared header — the user could widen the window from the empty state, and then had no way back short of editing the URL.',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    // Named, not positional: the sort select sits in the same wrapping row.
    await userEvent.click(canvas.getByRole('combobox', { name: /time window/i }))

    const body = within(document.body)
    await userEvent.click(await body.findByRole('option', { name: '7 days' }))

    await waitFor(() => {
      expect(document.querySelectorAll('[role="listbox"]').length).toBe(0)
    })

    expect(localStorage.getItem(WINDOW_STORAGE_KEY)).toBe('7')
    expect(getRouter().push).toHaveBeenCalledWith('/shopping?days=7')
  },
}
