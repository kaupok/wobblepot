import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, fn, within } from 'storybook/test'
import { createIngredientResult, createMealFormComponent } from '@/stories/fixtures'
import { expectAtMostLines, expectWithinHorizontally } from '@/stories/layout-helpers'
import { ComponentList } from './ComponentList'

const standardComponents = [
  createMealFormComponent({
    ingredient: createIngredientResult({ id: 'chicken-thigh' }),
    totalQuantity: 600,
  }),
  createMealFormComponent({
    ingredient: createIngredientResult({ id: 'potato' }),
    totalQuantity: 800,
  }),
  createMealFormComponent({
    ingredient: createIngredientResult({ id: 'lemon' }),
    totalQuantity: 2,
  }),
]

const componentsWithDuplicates = [
  ...standardComponents,
  createMealFormComponent({
    ingredient: createIngredientResult({ id: 'chicken-thigh' }),
    totalQuantity: 200,
  }),
]

const componentsWithVague = [
  createMealFormComponent({
    ingredient: createIngredientResult({ id: 'chicken-thigh' }),
    totalQuantity: 600,
  }),
  createMealFormComponent({
    ingredient: createIngredientResult({ id: 'olive-oil' }),
    totalQuantity: 0,
    isVague: true,
    originalPhrase: 'a generous drizzle',
  }),
]

const componentsWithInvalidQuantity = [
  createMealFormComponent({
    ingredient: createIngredientResult({ id: 'chicken-thigh' }),
    totalQuantity: 0,
  }),
]

const buildDuplicateMap = (rows: typeof standardComponents): Map<string, number[]> => {
  const map = new Map<string, number[]>()
  rows.forEach((row, idx) => {
    const indices = map.get(row.ingredientId) ?? []
    indices.push(idx)
    map.set(row.ingredientId, indices)
  })
  const result = new Map<string, number[]>()
  map.forEach((indices, id) => {
    if (indices.length > 1) result.set(id, indices)
  })
  return result
}

const meta = {
  title: 'Feature/Household/ComponentList',
  component: ComponentList,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'Editable ingredient list rendered inside `MealForm` (non-import mode). Each row exposes quantity input, "No quantity" toggle, and remove. All mutations forward to parent callbacks.',
      },
    },
  },
  args: {
    servings: 4,
    disabled: false,
    duplicateMap: new Map(),
    onRemove: fn(),
    onUpdateQuantity: fn(),
    onSetQuantity: fn(),
    onMarkAsVague: fn(),
  },
} satisfies Meta<typeof ComponentList>

export default meta
type Story = StoryObj<typeof meta>

// WHY: Pure controlled-input wrapper — every state change forwards through
// callbacks to `MealForm`, which owns the source of truth. Visual variants
// below cover the rendering branches; behavioural assertions belong with
// `MealForm` integration tests.

export const Empty: Story = {
  args: { components: [] },
  parameters: {
    docs: {
      description: {
        story:
          'Empty list returns null — used to verify the component does not crash with no rows.',
      },
    },
  },
}

export const Populated: Story = {
  args: { components: standardComponents },
  parameters: {
    docs: {
      description: {
        story: 'Three standard rows with quantity inputs and unit labels.',
      },
    },
  },
}

export const WithVague: Story = {
  args: { components: componentsWithVague },
  parameters: {
    docs: {
      description: {
        story:
          'One row marked as "no quantity" with the original phrase italicized — the "Set quantity" button replaces the input.',
      },
    },
  },
}

const componentsWithKnownVague = [
  componentsWithVague[0]!,
  { ...componentsWithVague[1]!, originalPhrase: 'to taste' },
]

export const WithVagueEstonian: Story = {
  name: 'With vague (Estonian)',
  globals: { locale: 'et' },
  args: { components: componentsWithKnownVague },
  parameters: {
    docs: {
      description: {
        story:
          'A phrase from the vocabulary renders through `enums.VaguePhrase` ("maitse järgi"); `WithVague` shows a phrase outside it ("a generous drizzle") passing through unchanged (HON-917).',
      },
    },
  },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('maitse järgi')).toBeVisible()
  },
}

export const WithDuplicates: Story = {
  args: {
    components: componentsWithDuplicates,
    duplicateMap: buildDuplicateMap(componentsWithDuplicates),
  },
  parameters: {
    docs: {
      description: {
        story:
          'Same ingredient added twice — both rows render the amber "Also used in row N" warning.',
      },
    },
  },
}

export const WithInvalidQuantity: Story = {
  args: { components: componentsWithInvalidQuantity },
  parameters: {
    docs: {
      description: {
        story:
          'Row with quantity ≤ 0 — destructive border + inline error renders so the validation failure is obvious.',
      },
    },
  },
}

// 600g / 400 servings = 1.5g — locale toggle renders the per-serving line as
// `1,5g per serving` in et, `1.5g per serving` in en.
export const EstonianLocale: Story = {
  args: {
    components: [
      createMealFormComponent({
        ingredient: createIngredientResult({ id: 'chicken-thigh' }),
        totalQuantity: 600,
      }),
    ],
    servings: 400,
  },
  globals: { locale: 'et' },
  parameters: {
    docs: {
      description: {
        story:
          'Estonian locale — per-serving quantity renders with a comma decimal (`1,5g per serving`) instead of a period.',
      },
    },
  },
}

// HON-834: at 390px each row's text column sat beside the quantity controls and
// shrank to one word per line. Below `sm` the controls stack under the text;
// from `sm` up they sit beside it as before.
function rowParts(row: HTMLElement) {
  const scope = within(row)
  return {
    name: row.querySelector<HTMLElement>('p')!,
    perServing: scope.getByText(/per serving|portsjoni kohta/),
    controls: [scope.getByRole('textbox'), ...scope.getAllByRole('button')],
  }
}

function rows(canvasElement: HTMLElement): HTMLElement[] {
  return Array.from(canvasElement.querySelectorAll<HTMLElement>('.rounded-md.border.p-3'))
}

async function expectStackedRows(canvasElement: HTMLElement) {
  const all = rows(canvasElement)
  await expect(all.length).toBe(componentsWithDuplicates.length)
  for (const row of all) {
    const { name, perServing, controls } = rowParts(row)
    for (const control of controls) expectWithinHorizontally(control, row)
    expectAtMostLines(name, 2)
    expectAtMostLines(perServing, 2)
    await expect(controls[0]!.getBoundingClientRect().top).toBeGreaterThanOrEqual(
      perServing.getBoundingClientRect().bottom,
    )
  }
}

const layoutArgs = {
  components: componentsWithDuplicates,
  duplicateMap: buildDuplicateMap(componentsWithDuplicates),
}

export const MobileLayout: Story = {
  args: layoutArgs,
  parameters: {
    docs: {
      description: {
        story:
          'At 390px the quantity controls stack under each ingredient, so the name and the "Also used in row N" warning keep the full row width (HON-834).',
      },
    },
  },
  play: async ({ canvasElement }) => {
    await expectStackedRows(canvasElement)
  },
}

export const MobileLayoutEstonian: Story = {
  args: layoutArgs,
  globals: { locale: 'et' },
  parameters: {
    docs: {
      description: {
        story:
          'The longer Estonian labels ("Kogus määramata", "portsjoni kohta") at 390px: same stacked layout, nothing clipped (HON-834).',
      },
    },
  },
  play: async ({ canvasElement }) => {
    await expectStackedRows(canvasElement)
  },
}

export const DesktopLayout: Story = {
  args: layoutArgs,
  globals: { viewport: { value: 'desktop', isRotated: false } },
  parameters: {
    docs: {
      description: {
        story: 'From `sm` up the controls sit beside each ingredient on one row (HON-834).',
      },
    },
  },
  play: async ({ canvasElement }) => {
    for (const row of rows(canvasElement)) {
      const { perServing, controls } = rowParts(row)
      for (const control of controls) expectWithinHorizontally(control, row)
      await expect(controls[0]!.getBoundingClientRect().left).toBeGreaterThan(
        perServing.getBoundingClientRect().right,
      )
    }
  },
}
