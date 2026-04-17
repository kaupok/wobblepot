import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, fn, userEvent, within } from 'storybook/test'
import { createCustomItem } from '@/stories/fixtures'
import { CustomShoppingItem } from './CustomShoppingItem'

// WHY: Checked / pending / disabled items intentionally render dimmer text
// to reinforce the "inactive" state. The checkbox's checked-state and the
// strikethrough decoration already communicate the status at the control
// level — per WCAG 1.4.3, text in inactive UI components is exempt from the
// contrast requirement. We waive `color-contrast` only on stories that
// exercise those dimmed states.
const inactiveStateA11y = {
  config: { rules: [{ id: 'color-contrast', enabled: false }] },
}

const meta = {
  title: 'Feature/Shopping/CustomShoppingItem',
  component: CustomShoppingItem,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'User-added shopping item. Supports check-off, unlink-from-ingredient (when linked), and delete. Linked items show a category label.',
      },
    },
  },
  args: {
    item: createCustomItem(),
    onToggle: fn(),
    onUnlink: fn(),
    onDelete: fn(),
  },
  decorators: [
    (Story) => (
      <div className="max-w-md">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof CustomShoppingItem>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: {
    item: createCustomItem({
      name: 'Olive oil',
      ingredientId: 'olive-oil',
      ingredientCategory: 'fat',
    }),
  },
}

export const Unlinked: Story = {
  args: {
    item: createCustomItem({
      id: 'custom-unlinked',
      name: 'Paper towels',
      ingredientId: null,
      ingredientCategory: null,
    }),
  },
  parameters: {
    docs: {
      description: {
        story: 'Not linked to an ingredient — no category label, no unlink button.',
      },
    },
  },
}

export const Checked: Story = {
  args: {
    item: createCustomItem({
      name: 'Olive oil',
      ingredientId: 'olive-oil',
      ingredientCategory: 'fat',
      checked: true,
    }),
  },
  parameters: { a11y: inactiveStateA11y },
}

export const Pending: Story = {
  args: {
    pending: true,
    item: createCustomItem({ name: 'Olive oil' }),
  },
  parameters: { a11y: inactiveStateA11y },
}

export const Disabled: Story = {
  args: {
    disabled: true,
    item: createCustomItem({ name: 'Olive oil' }),
  },
  parameters: { a11y: inactiveStateA11y },
}

export const AllStates: Story = {
  parameters: { a11y: inactiveStateA11y },
  render: () => (
    <div className="flex flex-col gap-2">
      <CustomShoppingItem
        item={createCustomItem({
          id: 'state-linked',
          name: 'Olive oil',
          ingredientId: 'olive-oil',
          ingredientCategory: 'fat',
        })}
        onToggle={fn()}
        onUnlink={fn()}
        onDelete={fn()}
      />
      <CustomShoppingItem
        item={createCustomItem({
          id: 'state-unlinked',
          name: 'Paper towels',
          ingredientId: null,
          ingredientCategory: null,
        })}
        onToggle={fn()}
        onUnlink={fn()}
        onDelete={fn()}
      />
      <CustomShoppingItem
        item={createCustomItem({
          id: 'state-checked',
          name: 'Parmesan',
          ingredientId: 'parmesan',
          ingredientCategory: 'dairy',
          checked: true,
        })}
        onToggle={fn()}
        onUnlink={fn()}
        onDelete={fn()}
      />
      <CustomShoppingItem
        item={createCustomItem({
          id: 'state-pending',
          name: 'Butter',
          ingredientId: 'butter',
          ingredientCategory: 'dairy',
        })}
        onToggle={fn()}
        onUnlink={fn()}
        onDelete={fn()}
        pending
      />
      <CustomShoppingItem
        item={createCustomItem({
          id: 'state-disabled',
          name: 'Whole milk',
          ingredientId: 'milk',
          ingredientCategory: 'dairy',
        })}
        onToggle={fn()}
        onUnlink={fn()}
        onDelete={fn()}
        disabled
      />
    </div>
  ),
}

// Play story — editing-flow equivalent: user toggles and deletes, both
// callbacks fire with the item id.
export const EditFlowPersistsValue: Story = {
  args: {
    item: createCustomItem({
      id: 'custom-flow',
      name: 'Olive oil',
      ingredientId: 'olive-oil',
      ingredientCategory: 'fat',
    }),
    onToggle: fn(),
    onDelete: fn(),
    onUnlink: fn(),
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    const checkbox = canvas.getByRole('checkbox')
    await userEvent.click(checkbox)
    await expect(args.onToggle).toHaveBeenCalledWith('custom-flow', true)

    const unlinkButton = canvas.getByLabelText('Unlink Olive oil from ingredient')
    await userEvent.click(unlinkButton)
    await expect(args.onUnlink).toHaveBeenCalledWith('custom-flow')

    const deleteButton = canvas.getByLabelText('Remove Olive oil')
    await userEvent.click(deleteButton)
    await expect(args.onDelete).toHaveBeenCalledWith('custom-flow')
  },
}
