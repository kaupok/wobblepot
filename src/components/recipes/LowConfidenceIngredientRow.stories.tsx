import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import {
  createIngredientAlternative,
  createLowConfidenceIngredientRowData,
} from '@/stories/fixtures'
import { expectAtMostLines, expectWithinHorizontally } from '@/stories/layout-helpers'
import { LowConfidenceIngredientRow } from './LowConfidenceIngredientRow'

const meta = {
  title: 'Feature/Recipes/LowConfidenceIngredientRow',
  component: LowConfidenceIngredientRow,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  args: {
    data: createLowConfidenceIngredientRowData(),
    servings: 4,
    disabled: false,
    onUpdate: fn(),
    onRemove: fn(),
    onQuantityChange: fn(),
    onSetQuantity: fn(),
    onMarkAsVague: fn(),
  },
  decorators: [
    (Story) => (
      <div className="max-w-2xl">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof LowConfidenceIngredientRow>

export default meta
type Story = StoryObj<typeof meta>

export const WithAlternatives: Story = {}

export const WithoutAlternatives: Story = {
  args: {
    data: createLowConfidenceIngredientRowData({ alternatives: [] }),
  },
  parameters: {
    docs: {
      description: {
        story:
          'No alternatives returned — the Select only exposes the best match and the user can Confirm.',
      },
    },
  },
}

export const Vague: Story = {
  args: {
    data: createLowConfidenceIngredientRowData({
      isVague: true,
      originalPhrase: 'a splash',
    }),
  },
  parameters: {
    docs: {
      description: {
        story:
          'Vague quantity ("to taste" / "a splash") renders the italic original phrase instead of the per-serving amount.',
      },
    },
  },
}

export const VagueEstonian: Story = {
  name: 'Vague (Estonian)',
  globals: { locale: 'et' },
  args: {
    data: createLowConfidenceIngredientRowData({ isVague: true, originalPhrase: 'a splash' }),
  },
  parameters: {
    docs: {
      description: {
        story:
          'The stored English phrase renders through `enums.VaguePhrase`, so an Estonian household reads "sorts" (HON-917).',
      },
    },
  },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('sorts')).toBeVisible()
  },
}

export const InvalidQuantity: Story = {
  args: {
    data: createLowConfidenceIngredientRowData({ totalQuantity: 0 }),
  },
  parameters: {
    docs: {
      description: {
        story: 'Zero quantity surfaces the destructive "Quantity must be greater than 0" error.',
      },
    },
  },
}

export const Duplicate: Story = {
  args: {
    duplicateIndices: [0, 2],
    data: createLowConfidenceIngredientRowData(),
  },
  parameters: {
    docs: {
      description: {
        story: 'This ingredient is also used in rows 1 and 3 — shows the amber duplicate warning.',
      },
    },
  },
}

export const Disabled: Story = {
  args: { disabled: true },
}

export const WithOriginalText: Story = {
  args: {
    data: createLowConfidenceIngredientRowData({
      originalText: '1 lb chicken thighs, bone-in',
    }),
  },
  parameters: {
    docs: {
      description: {
        story: 'Renders the raw extractor input alongside the resolved ingredient.',
      },
    },
  },
}

// 600g / 400 servings = 1.5g — locale toggle renders as `1,5g` in et.
export const EstonianLocale: Story = {
  args: {
    data: createLowConfidenceIngredientRowData({ totalQuantity: 600 }),
    servings: 400,
  },
  globals: { locale: 'et' },
  parameters: {
    docs: {
      description: {
        story:
          'Estonian locale — per-serving quantity renders with a comma decimal (`1,5g`) instead of a period.',
      },
    },
  },
}

// Play stories — verify `onUpdate` / `onRemove` contracts under
// @storybook/addon-vitest. Radix Select content renders through a portal outside
// `canvasElement`, so option queries go through `within(document.body)`.

export const SelectingAlternativeInvokesOnUpdate: Story = {
  args: {
    data: createLowConfidenceIngredientRowData({
      alternatives: [
        createIngredientAlternative({
          id: 'chicken-breast',
          name: 'Chicken breast',
          category: 'protein',
          defaultUnit: 'g',
          similarity: 0.82,
        }),
      ],
    }),
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    const trigger = canvas.getByRole('combobox', { name: /verify ingredient match/i })
    await userEvent.click(trigger)

    const body = within(document.body)
    const option = await body.findByRole('option', { name: /chicken breast/i })
    await userEvent.click(option)

    // Wait for the Select's close sequence to finish before the play function
    // returns. Radix keeps the content mounted through its exit animation
    // (`role="listbox"`, `data-state="closed"`) and leaves its `aria-hidden`
    // layer wrapper in place until then, so the a11y gate — which runs in an
    // `afterEach` — otherwise audits a half-closed dropdown and reports
    // `aria-input-field-name` and `aria-hidden-focus` against DOM no user can
    // reach. Same rationale as `awaitDialogClosed` in `@/stories/a11y-helpers`:
    // awaiting unmount is the assertion that the close sequence completed.
    await waitFor(() => {
      expect(document.querySelectorAll('[role="listbox"]').length).toBe(0)
    })

    await expect(args.onUpdate).toHaveBeenCalledTimes(1)
    await expect(args.onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'matched',
        ingredient: expect.objectContaining({ id: 'chicken-breast', name: 'Chicken breast' }),
        totalQuantity: 600,
      }),
    )
  },
}

export const ConfirmBestMatchInvokesOnUpdate: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    const confirm = canvas.getByRole('button', { name: /^confirm$/i })
    await userEvent.click(confirm)

    await expect(args.onUpdate).toHaveBeenCalledTimes(1)
    await expect(args.onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'matched',
        ingredient: expect.objectContaining({ id: 'chicken-thigh' }),
        totalQuantity: 600,
      }),
    )
  },
}

export const RemoveInvokesOnRemove: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    const remove = canvas.getByRole('button', { name: /remove ingredient/i })
    await userEvent.click(remove)
    await expect(args.onRemove).toHaveBeenCalledTimes(1)
  },
}

// HON-834: at 390px the top row squeezed the text column beside the quantity
// controls, and the fixed-width match select ran past the tile. Below `sm` the
// controls stack under the text and the label sits above a full-width select.
function measureRow(canvasElement: HTMLElement) {
  const canvas = within(canvasElement)
  const name = canvas.getByText('chicken thighs')
  const original = canvas.getByText(/600g chicken thighs/)
  const perServing = canvas.getByText(/per serving|portsjoni kohta/)
  const row = name.closest<HTMLElement>('.rounded-md')!
  const controls = [
    canvas.getByRole('textbox', { name: /quantity|kogus/i }),
    canvas.getByRole('combobox'),
    ...canvas.getAllByRole('button'),
  ]
  return { canvas, name, original, perServing, row, controls }
}

async function expectStackedRow(canvasElement: HTMLElement) {
  const { canvas, name, original, perServing, row, controls } = measureRow(canvasElement)
  for (const control of controls) expectWithinHorizontally(control, row)
  expectAtMostLines(name, 2)
  expectAtMostLines(original, 2)
  expectAtMostLines(perServing, 2)
  await expect(controls[0]!.getBoundingClientRect().top).toBeGreaterThanOrEqual(
    perServing.getBoundingClientRect().bottom,
  )
  // The "Verify match:" label sits above the select.
  const label = canvas.getByText(/verify match|kontrolli sobitust/i)
  await expect(controls[1]!.getBoundingClientRect().top).toBeGreaterThanOrEqual(
    label.getBoundingClientRect().bottom,
  )
}

export const MobileLayout: Story = {
  args: { duplicateIndices: [0, 2] },
  parameters: {
    docs: {
      description: {
        story:
          'At 390px the quantity controls stack under the text, and the "Verify match:" label sits above a select that fills the row, so nothing runs past the tile (HON-834).',
      },
    },
  },
  play: async ({ canvasElement }) => {
    await expectStackedRow(canvasElement)
  },
}

export const MobileLayoutEstonian: Story = {
  args: { duplicateIndices: [0, 2] },
  globals: { locale: 'et' },
  parameters: {
    docs: {
      description: {
        story:
          'The longer Estonian labels at 390px: same stacked layout, nothing clipped (HON-834).',
      },
    },
  },
  play: async ({ canvasElement }) => {
    await expectStackedRow(canvasElement)
  },
}

export const DesktopLayout: Story = {
  args: { duplicateIndices: [0, 2] },
  globals: { viewport: { value: 'desktop', isRotated: false } },
  parameters: {
    docs: {
      description: {
        story:
          'From `sm` up the controls sit beside the text, and the label beside the select, as before (HON-834).',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const { canvas, perServing, row, controls } = measureRow(canvasElement)
    for (const control of controls) expectWithinHorizontally(control, row)
    const label = canvas.getByText(/verify match/i)
    await expect(controls[0]!.getBoundingClientRect().left).toBeGreaterThan(
      perServing.getBoundingClientRect().right,
    )
    await expect(controls[1]!.getBoundingClientRect().left).toBeGreaterThan(
      label.getBoundingClientRect().right,
    )
  },
}
