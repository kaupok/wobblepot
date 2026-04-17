import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { fn } from 'storybook/test'
import { createIngredientResult, createMealFormComponent } from '@/stories/fixtures'
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
