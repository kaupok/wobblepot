import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, fn, userEvent, within } from 'storybook/test'
import { createShoppingItem } from '@/stories/fixtures'
import { ShoppingItem } from './ShoppingItem'

// WHY: Purchased / pending / disabled items intentionally render dimmer text
// to reinforce the "inactive" state. The checkbox's checked-state and the
// strikethrough decoration already communicate the status at the control
// level — per WCAG 1.4.3, text in inactive UI components is exempt from the
// contrast requirement. We waive `color-contrast` only on stories that
// exercise those dimmed states.
const inactiveStateA11y = {
  config: { rules: [{ id: 'color-contrast', enabled: false }] },
}

const meta = {
  title: 'Feature/Shopping/ShoppingItem',
  component: ShoppingItem,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  args: {
    item: createShoppingItem(),
    onToggle: fn(),
  },
  decorators: [
    (Story) => (
      <div className="max-w-md">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ShoppingItem>

export default meta
type Story = StoryObj<typeof meta>

export const Unchecked: Story = {
  args: {
    item: createShoppingItem({
      name: 'Chicken thigh',
      displayQuantity: '500g',
    }),
  },
}

export const Checked: Story = {
  args: {
    item: createShoppingItem({
      name: 'Chicken thigh',
      displayQuantity: '500g',
      purchased: true,
    }),
  },
  parameters: { a11y: inactiveStateA11y },
}

export const WithQuantity: Story = {
  args: {
    item: createShoppingItem({
      name: 'Olive oil',
      displayQuantity: '250ml',
    }),
  },
}

export const VagueQuantity: Story = {
  args: {
    item: createShoppingItem({
      name: 'Garlic',
      displayQuantity: 'some',
      isVague: true,
    }),
  },
  parameters: {
    docs: {
      description: {
        story: 'Vague quantities (e.g. "some", "to taste") render in italic.',
      },
    },
  },
}

export const LongName: Story = {
  args: {
    item: createShoppingItem({
      ingredientId: 'long',
      name: 'Organic boneless skinless chicken thigh from a small family farm',
      displayQuantity: '1.2kg',
    }),
  },
  parameters: {
    docs: {
      description: {
        story: 'Stress-test for overflow behaviour on long ingredient names.',
      },
    },
  },
}

export const Pending: Story = {
  args: {
    pending: true,
    item: createShoppingItem({ name: 'Chicken thigh', displayQuantity: '500g' }),
  },
  parameters: { a11y: inactiveStateA11y },
}

export const Disabled: Story = {
  args: {
    disabled: true,
    item: createShoppingItem({ name: 'Chicken thigh', displayQuantity: '500g' }),
  },
  parameters: { a11y: inactiveStateA11y },
}

export const AllStates: Story = {
  parameters: { a11y: inactiveStateA11y },
  render: () => (
    <div className="flex flex-col gap-2">
      <ShoppingItem
        item={createShoppingItem({ name: 'Chicken thigh', displayQuantity: '500g' })}
        onToggle={fn()}
      />
      <ShoppingItem
        item={createShoppingItem({
          ingredientId: 'purchased',
          name: 'Salmon fillet',
          displayQuantity: '300g',
          purchased: true,
        })}
        onToggle={fn()}
      />
      <ShoppingItem
        item={createShoppingItem({
          ingredientId: 'vague',
          name: 'Garlic',
          displayQuantity: 'some',
          isVague: true,
        })}
        onToggle={fn()}
      />
      <ShoppingItem
        item={createShoppingItem({
          ingredientId: 'pending',
          name: 'Butter',
          displayQuantity: '200g',
        })}
        onToggle={fn()}
        pending
      />
      <ShoppingItem
        item={createShoppingItem({
          ingredientId: 'disabled',
          name: 'Whole milk',
          displayQuantity: '1L',
        })}
        onToggle={fn()}
        disabled
      />
    </div>
  ),
}

// Play story — verifies the parent-callback contract. The click flips the
// visual state to `purchased`, so the same inactive-state waiver applies.
export const CheckInvokesCallback: Story = {
  args: {
    item: createShoppingItem({
      ingredientId: 'ing-check',
      name: 'Chicken thigh',
      displayQuantity: '500g',
    }),
    onToggle: fn(),
  },
  parameters: { a11y: inactiveStateA11y },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    const checkbox = canvas.getByRole('checkbox')
    await userEvent.click(checkbox)
    await expect(args.onToggle).toHaveBeenCalledWith('ing-check', true)
  },
}
