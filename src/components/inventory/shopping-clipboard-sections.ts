import { CATEGORY_EMOJI, CUSTOM_ITEMS_EMOJI } from '@/components/shopping/CategoryGroup'
import type { CustomItemData } from '@/components/shopping/CustomItemInput'
import type { ShoppingItemData } from '@/components/shopping/ShoppingItem'
import type { IngredientCategory } from '@/generated/prisma/enums'
import type { ClipboardSection } from '@/lib/shopping/format-clipboard'

import type {
  buildAlphabeticalItems,
  buildUrgencyGroups,
  SortMode,
  splitCustomItems,
} from './shopping-sort'

type UrgencyGroupData = ReturnType<typeof buildUrgencyGroups>[number]

/** The section's groupings for the active sort mode, as `ShoppingSection` computes them. */
interface ClipboardGroups {
  sortMode: SortMode
  alphabeticalItems: ReturnType<typeof buildAlphabeticalItems>
  urgencyGroups: UrgencyGroupData[]
  undatedCustomItems: CustomItemData[]
  categoryGroups: { category: IngredientCategory; items: ShoppingItemData[] }[]
  linkedCustomByCategory: ReturnType<typeof splitCustomItems>['linkedCustomByCategory']
  unlinkedCustomItems: CustomItemData[]
}

/** The translated headings, so this module stays free of `next-intl`. */
interface ClipboardLabels {
  customItems: (count: number) => string
  other: (count: number) => string
  urgency: (bucket: UrgencyGroupData['bucket']) => string
  category: (category: IngredientCategory) => string
}

/**
 * Sections for the clipboard export, mirroring the grouping and ordering of
 * the active sort mode. Purchased/checked items are dropped — the paste is a
 * to-buy list — so every heading count is derived from the surviving lines
 * rather than from the on-screen total, which still includes them.
 */
export function buildClipboardSectionsFor(
  {
    sortMode,
    alphabeticalItems,
    urgencyGroups,
    undatedCustomItems,
    categoryGroups,
    linkedCustomByCategory,
    unlinkedCustomItems,
  }: ClipboardGroups,
  labels: ClipboardLabels,
): ClipboardSection[] {
  // A ran-out staple with no amount (HON-1398) is the name alone.
  const computedLine = (item: ShoppingItemData) =>
    item.displayQuantity ? `${item.name} ${item.displayQuantity}` : item.name
  const customLine = (item: CustomItemData) => item.name
  const toBuy = (items: ShoppingItemData[]) => items.filter((item) => !item.purchased)
  const unchecked = (items: CustomItemData[]) => items.filter((item) => !item.checked)

  if (sortMode === 'alphabetical') {
    return [
      {
        heading: null,
        lines: alphabeticalItems
          .filter((entry) =>
            entry.kind === 'computed' ? !entry.item.purchased : !entry.item.checked,
          )
          .map((entry) =>
            entry.kind === 'computed' ? computedLine(entry.item) : customLine(entry.item),
          ),
      },
    ]
  }

  if (sortMode === 'urgency') {
    // Undated custom items lead, as on screen.
    const customLines = unchecked(undatedCustomItems).map(customLine)
    return [
      {
        heading: `${CUSTOM_ITEMS_EMOJI} ${labels.customItems(customLines.length)}`,
        lines: customLines,
      },
      ...urgencyGroups.map((group) => {
        const lines = [
          ...toBuy(group.items).map(computedLine),
          ...unchecked(group.customItems).map(customLine),
        ]
        return { heading: `${labels.urgency(group.bucket)} (${lines.length})`, lines }
      }),
    ]
  }

  const categorySection = (
    category: IngredientCategory,
    items: ShoppingItemData[],
    linked: CustomItemData[] | undefined,
  ): ClipboardSection => {
    const lines = [...toBuy(items).map(computedLine), ...unchecked(linked ?? []).map(customLine)]
    return {
      heading: `${CATEGORY_EMOJI[category]} ${labels.category(category)} (${lines.length})`,
      lines,
    }
  }

  const sections: ClipboardSection[] = categoryGroups.map((group) =>
    categorySection(group.category, group.items, linkedCustomByCategory.get(group.category)),
  )

  // Categories reached only by a custom item get their own group on screen too.
  for (const [category, items] of linkedCustomByCategory.entries()) {
    if (categoryGroups.some((group) => group.category === category)) continue
    sections.push(categorySection(category as IngredientCategory, [], items))
  }

  const otherLines = unchecked(unlinkedCustomItems).map(customLine)
  sections.push({
    heading: `${CUSTOM_ITEMS_EMOJI} ${labels.other(otherLines.length)}`,
    lines: otherLines,
  })

  return sections
}
