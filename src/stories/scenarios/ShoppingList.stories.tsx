import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import type { IngredientCategory } from '@/generated/prisma/enums'
import { useTranslations } from 'next-intl'
import { expect, fn, within } from 'storybook/test'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Body, Heading } from '@/components/ui/typography'
import { CategoryGroup } from '@/components/shopping/CategoryGroup'
import { CustomShoppingItem } from '@/components/shopping/CustomShoppingItem'
import { UrgencyGroup } from '@/components/shopping/UrgencyGroup'
import { ShoppingEmptyState } from '@/components/inventory/ShoppingEmptyState'
import {
  customShoppingItems,
  dairyShoppingItems,
  produceShoppingItems,
  proteinShoppingItems,
  shoppingItemsByUrgency,
} from '@/stories/fixtures'
import { assertDesignRules, SCENARIO_RULES } from '@/stories/design-rules'

// WHY: Purchased and checked-off rows intentionally render dimmer text to
// reinforce their inactive state — the checkbox and strikethrough already
// carry the status, and WCAG 1.4.3 exempts text in inactive UI components.
// Same narrow waiver the ShoppingItem / CategoryGroup stories use.
const inactiveStateA11y = {
  config: { rules: [{ id: 'color-contrast', enabled: false }] },
}

/** `ShoppingEmptyState` reads this on mount; see the `Empty` story's cleanup. */
const WINDOW_STORAGE_KEY = 'shopping-list-window-days'

const URGENCY_BUCKETS = ['today', 'tomorrow', 'this-week', 'later'] as const

const CATEGORY_GROUPS = [
  { category: 'protein', items: proteinShoppingItems },
  { category: 'vegetable', items: produceShoppingItems },
  { category: 'dairy', items: dairyShoppingItems },
] as const

const urgencyItems = URGENCY_BUCKETS.flatMap((bucket) => shoppingItemsByUrgency[bucket])
const categoryItems = CATEGORY_GROUPS.flatMap((group) => group.items)

/**
 * Both modes render one checkbox per row, so this is what the header count has
 * to agree with. Asserted in the play functions: a custom item whose category
 * no computed group covers used to be counted but never rendered.
 */
const URGENCY_ROW_COUNT = urgencyItems.length + customShoppingItems.length
const CATEGORY_ROW_COUNT = categoryItems.length + customShoppingItems.length

/** Custom items with no ingredient behind them — the "Other" group in category mode. */
const unlinkedCustomItems = customShoppingItems.filter((item) => item.ingredientCategory === null)

/**
 * Categories reached only by a custom item — the fixture's olive oil is `fat`,
 * which no computed group covers. `ShoppingSection.tsx:301-316` gives each one
 * its own `CategoryGroup` with an empty `items` array; without that pass the
 * item renders nowhere and the header count overstates the list.
 */
const customOnlyCategories = [
  ...new Set(
    customShoppingItems
      .map((item) => item.ingredientCategory)
      .filter(
        (category): category is IngredientCategory =>
          category !== null && !CATEGORY_GROUPS.some((group) => group.category === category),
      ),
  ),
]

interface ShoppingListScreenProps {
  /** Which grouping `ShoppingSection` is showing. The two modes are either/or. */
  sort: 'urgency' | 'category'
  onToggleItem: (ingredientId: string, purchased: boolean) => void
  onToggleCustomItem: (id: string, checked: boolean) => void
  onUnlinkCustomItem: (id: string) => void
  onDeleteCustomItem: (id: string) => void
}

/**
 * The `/shopping` list with items on it, composed the way
 * `src/components/inventory/ShoppingSection.tsx` composes it: one page-title
 * card, then grouped rows. Data is fixed, so the only thing that moves between
 * runs is the layout under review.
 */
function ShoppingListScreen({
  sort,
  onToggleItem,
  onToggleCustomItem,
  onUnlinkCustomItem,
  onDeleteCustomItem,
}: ShoppingListScreenProps) {
  const tShopping = useTranslations('shopping')

  const computedItems = sort === 'urgency' ? urgencyItems : categoryItems
  const totalItems = computedItems.length + customShoppingItems.length
  const totalPurchased =
    computedItems.filter((item) => item.purchased).length +
    customShoppingItems.filter((item) => item.checked).length
  const checkedCustomCount = customShoppingItems.filter((item) => item.checked).length
  const checkedUnlinkedCount = unlinkedCustomItems.filter((item) => item.checked).length

  return (
    <Card className="w-full">
      <CardHeader>
        <div className="flex flex-col gap-1">
          <Heading variant="h4">{tShopping('title')}</Heading>
          <Body variant="muted">
            {tShopping('windowNext7')} · {tShopping('itemCount', { count: totalItems })} ·{' '}
            {tShopping('purchasedTail', { count: totalPurchased })}
          </Body>
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-6">
          {sort === 'urgency' ? (
            <>
              {URGENCY_BUCKETS.map((bucket) => (
                <UrgencyGroup
                  key={bucket}
                  bucket={bucket}
                  items={shoppingItemsByUrgency[bucket]}
                  onToggleItem={onToggleItem}
                />
              ))}
              {/* Urgency mode has no per-item date for custom items, so it
                  collapses all of them into one group. */}
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <Body variant="small" className="text-muted-foreground font-medium">
                    {tShopping('customItemsSection', { count: customShoppingItems.length })}
                  </Body>
                  <Body variant="muted">
                    {checkedCustomCount}/{customShoppingItems.length}
                  </Body>
                </div>
                <div className="flex flex-col gap-1">
                  {customShoppingItems.map((item) => (
                    <CustomShoppingItem
                      key={item.id}
                      item={item}
                      onToggle={onToggleCustomItem}
                      onUnlink={onUnlinkCustomItem}
                      onDelete={onDeleteCustomItem}
                    />
                  ))}
                </div>
              </div>
            </>
          ) : (
            <>
              {CATEGORY_GROUPS.map((group) => (
                <CategoryGroup
                  key={group.category}
                  category={group.category}
                  items={group.items}
                  customItems={customShoppingItems.filter(
                    (item) => item.ingredientCategory === group.category,
                  )}
                  onToggleItem={onToggleItem}
                  onToggleCustomItem={onToggleCustomItem}
                  onUnlinkCustomItem={onUnlinkCustomItem}
                  onDeleteCustomItem={onDeleteCustomItem}
                />
              ))}
              {customOnlyCategories.map((category) => (
                <CategoryGroup
                  key={category}
                  category={category}
                  items={[]}
                  customItems={customShoppingItems.filter(
                    (item) => item.ingredientCategory === category,
                  )}
                  onToggleItem={onToggleItem}
                  onToggleCustomItem={onToggleCustomItem}
                  onUnlinkCustomItem={onUnlinkCustomItem}
                  onDeleteCustomItem={onDeleteCustomItem}
                />
              ))}
              {/* Custom items with no ingredient have no category to sit in. */}
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <Body variant="small" className="text-muted-foreground font-medium">
                    {tShopping('otherSection', { count: unlinkedCustomItems.length })}
                  </Body>
                  {checkedUnlinkedCount > 0 && (
                    <Body variant="muted">
                      {checkedUnlinkedCount}/{unlinkedCustomItems.length}
                    </Body>
                  )}
                </div>
                <div className="flex flex-col gap-1">
                  {unlinkedCustomItems.map((item) => (
                    <CustomShoppingItem
                      key={item.id}
                      item={item}
                      onToggle={onToggleCustomItem}
                      onUnlink={onUnlinkCustomItem}
                      onDelete={onDeleteCustomItem}
                    />
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

const meta = {
  title: 'Scenarios/Shopping list',
  component: ShoppingListScreen,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'The `/shopping` screen as a whole, not a single component. Makes the composition rules visible: headings divide the list while only the interactive rows carry a border, every row clears the 44px touch floor, and the page title stays at the Title level. Props are fixed — see `.storybook/README.md` → "Scenario stories".',
      },
    },
  },
  args: {
    sort: 'urgency',
    onToggleItem: fn(),
    onToggleCustomItem: fn(),
    onUnlinkCustomItem: fn(),
    onDeleteCustomItem: fn(),
  },
} satisfies Meta<typeof ShoppingListScreen>

export default meta
type Story = StoryObj<typeof meta>

export const Populated: Story = {
  args: { sort: 'urgency' },
  parameters: {
    a11y: inactiveStateA11y,
    docs: {
      description: {
        story:
          'Default urgency grouping: four `UrgencyGroup` buckets of `ShoppingItem` rows, then the single "Custom items" group of `CustomShoppingItem` rows that urgency mode collapses them into.',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getAllByRole('checkbox')).toHaveLength(URGENCY_ROW_COUNT)
    await assertDesignRules(canvasElement, SCENARIO_RULES)
  },
}

export const ByCategory: Story = {
  args: { sort: 'category' },
  parameters: {
    a11y: inactiveStateA11y,
    docs: {
      description: {
        story:
          'Category grouping — `CategoryGroup` interleaves each category\'s linked `CustomShoppingItem` rows with its computed ones. A custom item in a category no computed item reaches (olive oil, `fat`) gets a group of its own, and the unlinked ones fall through to "Other", so every item the header counts has somewhere to land.',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getAllByRole('checkbox')).toHaveLength(CATEGORY_ROW_COUNT)
    await assertDesignRules(canvasElement, SCENARIO_RULES)
  },
}

export const Empty: Story = {
  // `nothing-needed` reconciles the stored window preference against its prop
  // on mount and pushes when they disagree. Clearing the key keeps this story
  // independent of whatever the ShoppingEmptyState stories left behind.
  beforeEach: () => {
    localStorage.removeItem(WINDOW_STORAGE_KEY)
    return () => localStorage.removeItem(WINDOW_STORAGE_KEY)
  },
  parameters: {
    docs: {
      description: {
        story:
          'Both empty states the screen can land on, stacked for comparison: `no-plan` (nothing to derive a list from, so one primary CTA) and `nothing-needed` (a plan exists but the pantry covers it, so the window picker sits on the title row instead). Each follows the empty-state copy formula — one `Body variant="muted"` line, at most one primary button, no illustration.',
      },
    },
  },
  render: () => (
    <div className="flex flex-col gap-6">
      <ShoppingEmptyState variant="no-plan" />
      <ShoppingEmptyState variant="nothing-needed" windowDays={7} />
    </div>
  ),
  play: async ({ canvasElement }) => {
    await assertDesignRules(canvasElement, SCENARIO_RULES)
  },
}
