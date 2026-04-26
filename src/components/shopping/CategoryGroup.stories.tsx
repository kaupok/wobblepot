import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, fn, userEvent, within } from 'storybook/test'
import {
  createShoppingItem,
  customShoppingItems,
  dairyShoppingItems,
  proteinShoppingItems,
  produceShoppingItems,
} from '@/stories/fixtures'
import { CategoryGroup } from './CategoryGroup'

// WHY: Purchased / checked custom items within a group intentionally render
// dimmer text to reinforce their inactive state. The checkbox + strikethrough
// already communicate it — WCAG 1.4.3 exempts inactive UI components.
const inactiveStateA11y = {
  config: { rules: [{ id: 'color-contrast', enabled: false }] },
}

const meta = {
  title: 'Feature/Shopping/CategoryGroup',
  component: CategoryGroup,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'Groups shopping items by ingredient category (emoji + label + progress count) and optionally interleaves custom user items. Returns `null` when the group would be empty.',
      },
    },
  },
  args: {
    onToggleItem: fn(),
    onToggleCustomItem: fn(),
    onUnlinkCustomItem: fn(),
    onDeleteCustomItem: fn(),
  },
  decorators: [
    (Story) => (
      <div className="max-w-md">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof CategoryGroup>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: {
    category: 'protein',
    items: proteinShoppingItems,
  },
  parameters: {
    a11y: inactiveStateA11y,
    docs: {
      description: {
        story: 'Mixed purchased/unpurchased items — progress count renders.',
      },
    },
  },
}

export const AllCheckedOff: Story = {
  args: {
    category: 'dairy',
    items: dairyShoppingItems,
  },
  parameters: {
    a11y: inactiveStateA11y,
    docs: {
      description: {
        story: 'Every item purchased — progress count shows `2/2`, rows have struck-through text.',
      },
    },
  },
}

export const SingleItem: Story = {
  args: {
    category: 'fat',
    items: [
      createShoppingItem({
        ingredientId: 'olive-oil-single',
        name: 'Olive oil',
        displayQuantity: '250ml',
      }),
    ],
  },
}

export const WithCustomItems: Story = {
  args: {
    category: 'vegetable',
    items: produceShoppingItems,
    customItems: customShoppingItems,
  },
  parameters: {
    a11y: inactiveStateA11y,
    docs: {
      description: {
        story:
          'Category group that interleaves canonical shopping items with user-added custom items. Total count combines both.',
      },
    },
  },
}

export const EmptyRendersNothing: Story = {
  name: 'Empty (renders null)',
  args: {
    category: 'protein',
    items: [],
  },
  parameters: {
    docs: {
      description: {
        story:
          'CategoryGroup returns `null` when it has no items and no custom items — keeps the shopping list clean.',
      },
    },
  },
}

// Play story — verifies the toggle callback fires with the correct ingredient
// id when a checkbox is clicked. (CategoryGroup itself has no "collapse"
// control — its header is label-only — so the play coverage focuses on the
// delegated onToggleItem wiring.)
export const ToggleItemInvokesCallback: Story = {
  args: {
    category: 'protein',
    items: proteinShoppingItems,
    onToggleItem: fn(),
  },
  parameters: { a11y: inactiveStateA11y },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    const chickenCheckbox = canvas.getByRole('checkbox', {
      name: /Mark Chicken thigh as purchased/i,
    })
    await userEvent.click(chickenCheckbox)
    await expect(args.onToggleItem).toHaveBeenCalledWith('chicken-thigh', true)
  },
}
