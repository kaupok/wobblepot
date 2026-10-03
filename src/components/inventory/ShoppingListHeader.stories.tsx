import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { getRouter } from '@storybook/nextjs-vite/navigation.mock'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import { useTranslations } from 'next-intl'
import { Copy, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
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
  total: number
  purchased: number
}

/** The summary `ShoppingSection` passes: item count, then the purchased tail once something is bought. */
function Summary({ total, purchased }: SummaryProps) {
  const tShopping = useTranslations('shopping')
  return (
    <>
      {tShopping('itemCount', { count: total })}
      {purchased > 0 && (
        <>
          {' '}
          <span className="whitespace-nowrap">
            · {tShopping('purchasedTail', { count: purchased })}
          </span>
        </>
      )}
    </>
  )
}

/** The three controls `ShoppingSection` passes as `children`, at their busiest, in its order. */
function ListControls() {
  const tShopping = useTranslations('shopping')
  const tSort = useTranslations('shopping.sort')
  return (
    <>
      <Select defaultValue="category">
        <SelectTrigger size="sm" className="w-37.5" aria-label={tShopping('ariaSort')}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="category">{tSort('category')}</SelectItem>
          <SelectItem value="urgency">{tSort('urgency')}</SelectItem>
          <SelectItem value="alphabetical">{tSort('alphabetical')}</SelectItem>
        </SelectContent>
      </Select>
      <Button variant="quiet" size="sm">
        <Copy className="mr-1 size-4" aria-hidden="true" />
        {tShopping('copyList')}
      </Button>
      <Button variant="quiet" size="sm">
        <Trash2 className="mr-1 size-4" aria-hidden="true" />
        {tShopping('clearChecked')}
      </Button>
    </>
  )
}

const meta = {
  title: 'Feature/Inventory/ShoppingListHeader',
  component: ShoppingListHeader,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    // The picker routes to the path it is on (`/shopping` or `/pantry`,
    // HON-776), so the play functions need a real one rather than `/`.
    nextjs: { navigation: { pathname: '/shopping' } },
    docs: {
      description: {
        component:
          "The header both `/shopping` branches share, on the page background: the column title with the populated list's summary on its baseline, then one row of controls — the 7/14-day window picker first, followed by whatever the branch owns. Putting the picker here is the point: before HON-624 it lived only in the `nothing-needed` empty state, so widening to 14 days surfaced items, swapped in `ShoppingSection`, and took the only control that could narrow it back off the screen.",
      },
    },
  },
  // The picker persists before navigating, so a played story would otherwise
  // change what every later story mounts with.
  beforeEach: () => () => localStorage.removeItem(WINDOW_STORAGE_KEY),
  args: {
    windowDays: 7,
  },
} satisfies Meta<typeof ShoppingListHeader>

export default meta
type Story = StoryObj<typeof meta>

export const EmptyState: Story = {
  parameters: {
    docs: {
      description: {
        story:
          'The shape `ShoppingEmptyState` renders for its two list-shaped variants: title, then the picker alone on the controls row.',
      },
    },
  },
  play: async ({ canvasElement }) => {
    // `getByRole`, not `findByRole`: the picker is part of the first render
    // rather than appearing after a mount effect, so it is in the server HTML
    // and does not pop in and re-wrap the row after hydration (HON-771).
    const picker = within(canvasElement).getByRole('combobox', { name: /time window/i })
    await expect(picker).toHaveTextContent('Next 7 days')
  },
}

export const Populated: Story = {
  args: {
    summary: <Summary total={12} purchased={3} />,
    children: <ListControls />,
  },
  parameters: {
    docs: {
      description: {
        story:
          "`ShoppingSection`'s header at its busiest — the window picker plus all three list controls. None of them can shrink (`Button`'s cva base is `shrink-0 whitespace-nowrap`, both selects are `w-37.5`), so at the default 390px viewport the two selects share the first line and the buttons take the next. This is the case the wrap exists for.",
      },
    },
  },
}

export const PopulatedFourteenDays: Story = {
  args: {
    windowDays: 14,
    summary: <Summary total={19} purchased={3} />,
    children: <ListControls />,
  },
  // Seeded so the story models a real user state — someone who chose 14 days.
  // The header itself does not reconcile (that is `InventoryPage`'s job), so
  // this only documents which state is on screen; it changes no behaviour here.
  beforeEach: () => {
    localStorage.setItem(WINDOW_STORAGE_KEY, '14')
    return () => localStorage.removeItem(WINDOW_STORAGE_KEY)
  },
  parameters: {
    docs: {
      description: {
        story:
          'The wider window. The picker is the only place the window is stated — the summary carries the count and the purchased tail — so nothing on screen can disagree with it.',
      },
    },
  },
}

export const WindowPickerSwitchesWindow: Story = {
  parameters: {
    docs: {
      description: {
        story:
          'Behavioural contract of the picker on the empty state: choosing "Next 14 days" persists the preference under `shopping-list-window-days` and routes to `/shopping?days=14`. The persistence is what makes the choice survive the navigation — the new page reads it back on mount.',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('combobox', { name: /time window/i }))

    // Radix portals `SelectContent` outside the canvas.
    const body = within(document.body)
    await userEvent.click(await body.findByRole('option', { name: 'Next 14 days' }))

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
    summary: <Summary total={19} purchased={3} />,
    children: <ListControls />,
  },
  // Seeded to 14 so the story starts from the state it claims to: a user whose
  // saved window is the wide one, narrowing it back.
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
    await userEvent.click(await body.findByRole('option', { name: 'Next 7 days' }))

    await waitFor(() => {
      expect(document.querySelectorAll('[role="listbox"]').length).toBe(0)
    })

    expect(localStorage.getItem(WINDOW_STORAGE_KEY)).toBe('7')
    expect(getRouter().push).toHaveBeenCalledWith('/shopping?days=7')
  },
}
