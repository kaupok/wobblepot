import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import type { AdjustProposal } from '@/lib/meal-planning/adjust-proposal'

import { AdjustReviewDialog } from './AdjustReviewDialog'

const toSalmon: AdjustProposal = {
  op: 'replace',
  original: { id: 'chicken-thigh', name: 'Chicken thigh' },
  originalIngredientId: 'chicken-thigh',
  replacesChangeId: null,
  replacement: {
    matched: true,
    ingredient: {
      id: 'salmon-fillet',
      name: 'Salmon fillet',
      defaultUnit: 'g',
      measuredByVolume: false,
    },
    quantityPerServing: 140,
  },
  reason: 'Salmon cooks in the same time and suits the lemon.',
}

const leaveOutPotato: AdjustProposal = {
  op: 'remove',
  original: { id: 'potato', name: 'Potato' },
  originalIngredientId: 'potato',
  replacesChangeId: null,
  replacement: null,
  reason: 'You asked for a lighter dinner.',
}

const addPaprika: AdjustProposal = {
  op: 'add',
  original: null,
  originalIngredientId: null,
  replacesChangeId: null,
  replacement: { matched: false, name: 'smoked paprika', quantity: 1, unit: 'g' },
  reason: 'A pinch adds warmth without heat.',
}

const meta = {
  title: 'Meal plan/AdjustReviewDialog',
  component: AdjustReviewDialog,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          '"Adjust recipe" review (HON-1244): one ticked row per change the AI proposes, with its reason. A replacement the catalogue did not match shows the ingredient search, and Apply waits until it is picked or unticked.',
      },
    },
  },
  args: {
    open: true,
    onOpenChange: fn(),
    instruction: 'Fish instead of chicken, and lighter',
    proposals: [toSalmon, leaveOutPotato],
    changes: [],
    existingIngredientIds: ['chicken-thigh', 'potato', 'lemon'],
    isApplying: false,
    onApply: fn(async () => true),
  },
} satisfies Meta<typeof AdjustReviewDialog>

export default meta
type Story = StoryObj<typeof meta>

/** Every catalogue match: Apply sends both rows as the entry's change set. */
export const Matched: Story = {
  play: async ({ args }) => {
    const body = within(document.body)
    await body.findByRole('dialog', { name: 'Suggested changes' })
    await expect(
      body.getByRole('checkbox', {
        name: 'Replace: Chicken thigh → Salmon fillet, 140g per serving',
      }),
    ).toBeChecked()
    await userEvent.click(body.getByRole('button', { name: 'Apply' }))
    await waitFor(() =>
      expect(args.onApply).toHaveBeenCalledWith([
        {
          originalIngredientId: 'chicken-thigh',
          replacementIngredientId: 'salmon-fillet',
          quantityPerServing: 140,
        },
        { originalIngredientId: 'potato', replacementIngredientId: null, quantityPerServing: null },
      ]),
    )
  },
}

/** No match for "smoked paprika": Apply waits for a pick from the search. */
export const Unmatched: Story = {
  args: { instruction: 'A bit more warmth', proposals: [addPaprika] },
  play: async ({ args }) => {
    const body = within(document.body)
    await body.findByRole('dialog', { name: 'Suggested changes' })
    const apply = body.getByRole('button', { name: 'Apply' })
    await expect(apply).toBeDisabled()
    await userEvent.type(body.getByRole('combobox'), 'garl')
    await userEvent.click(await body.findByRole('option', { name: /^Garlic/ }))
    await expect(
      body.getByRole('checkbox', { name: /^Add: Garlic, .* per serving$/ }),
    ).toBeChecked()
    await userEvent.click(apply)
    await waitFor(() =>
      expect(args.onApply).toHaveBeenCalledWith([
        expect.objectContaining({ originalIngredientId: null, replacementIngredientId: 'garlic' }),
      ]),
    )
  },
}

/** A matched and an unmatched row together; unticking the unmatched one frees Apply. */
export const MatchedAndUnmatched: Story = {
  args: { proposals: [toSalmon, addPaprika] },
  play: async () => {
    const body = within(document.body)
    await body.findByRole('dialog', { name: 'Suggested changes' })
    const apply = body.getByRole('button', { name: 'Apply' })
    await expect(apply).toBeDisabled()
    await userEvent.click(
      body.getByRole('checkbox', { name: 'Add: smoked paprika, 1g per serving' }),
    )
    await expect(apply).toBeEnabled()
  },
}

/** While the set is stored, every control waits. */
export const Applying: Story = {
  args: { isApplying: true },
}
