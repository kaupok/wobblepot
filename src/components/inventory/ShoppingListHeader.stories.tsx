import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { getRouter } from '@storybook/nextjs-vite/navigation.mock'
import { Copy, Trash2 } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { expect, userEvent, waitFor, within } from 'storybook/test'

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
        <SelectTrigger size="sm" aria-label={tShopping('ariaSort')}>
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
          "The shopping list's header, on the page background: the column title with the list's summary on its baseline, then one row of controls — the 7/14-day window picker first, followed by the list's own controls. An empty list renders it too (HON-1354). Putting the picker here is the point: before HON-624 it lived only in the `nothing-needed` empty state, so widening to 14 days surfaced items, swapped in `ShoppingSection`, and took the only control that could narrow it back off the screen.",
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
          'The header with no summary and no list controls: title, then the picker alone on the controls row. No screen renders this shape since HON-1354 (an empty list keeps its sort select); it pins the picker in the first render.',
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
          "`ShoppingSection`'s header at its busiest — the window picker plus all three list controls. None of them can shrink (`Button`'s cva base is `shrink-0 whitespace-nowrap`, each select is as wide as its value), so the row wraps onto a second line at the default 390px viewport. This is the case the wrap exists for.",
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
          'Behavioural contract of the picker: choosing "Next 14 days" persists the preference under `shopping-list-window-days` and routes to `/shopping?days=14`. The persistence is what makes the choice survive the navigation — the new page reads it back on mount.',
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

export const PopulatedEstonian: Story = {
  args: {
    windowDays: 7,
    summary: <Summary total={12} purchased={3} />,
    children: <ListControls />,
  },
  globals: { locale: 'et' },
  beforeEach: () => {
    localStorage.setItem(WINDOW_STORAGE_KEY, '7')
    return () => localStorage.removeItem(WINDOW_STORAGE_KEY)
  },
  parameters: {
    docs: {
      description: {
        story:
          'The busiest header in Estonian at 390px. "Järgmised 7 päeva" and "Kiireloomulisuse järgi" run longer than the English labels, and a fixed `w-37.5` trigger clipped both (HON-1465). Each select now sizes to its value, and the row wraps instead of overflowing.',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const sort = canvas.getByRole('combobox', { name: 'Sorteeri tooteid' })
    await userEvent.click(sort)
    await userEvent.click(
      await within(document.body).findByRole('option', { name: 'Kiireloomulisuse järgi' }),
    )
    await waitFor(() => {
      expect(document.querySelectorAll('[role="listbox"]').length).toBe(0)
    })

    const picker = canvas.getByRole('combobox', { name: 'Ajavahemik' })
    await expect(picker).toHaveTextContent('Järgmised 7 päeva')
    await expect(sort).toHaveTextContent('Kiireloomulisuse järgi')
    for (const trigger of [picker, sort]) {
      const value = trigger.querySelector<HTMLElement>('[data-slot="select-value"]')
      if (!value) throw new globalThis.Error('Expected the select value span')
      expect(value.scrollWidth).toBeLessThanOrEqual(value.clientWidth)
    }
    const row = picker.parentElement
    if (!row) throw new globalThis.Error('Expected the controls row')
    expect(row.scrollWidth).toBeLessThanOrEqual(row.clientWidth)
    const copy = canvas.getByRole('button', { name: /Kopeeri nimekiri/ })
    expect(copy.getBoundingClientRect().right).toBeLessThanOrEqual(
      row.getBoundingClientRect().right,
    )
  },
}
