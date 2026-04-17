import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import {
  createIngredientResult,
  createLowConfidencePrefilledIngredient,
  createUnmatchedPrefilledIngredient,
  ingredientResults,
} from '@/stories/fixtures'
import { submittingMealFormHandlers } from '@/stories/msw-handlers'
import { MealForm } from './MealForm'
import type { MealFormData } from './meal-form-types'

const editMeal: MealFormData = {
  id: 'meal-existing',
  name: 'Lemon-garlic roast chicken',
  description: 'Weeknight-friendly sheet-pan dinner with crisp skin and bright citrus.',
  preparationNotes: 'Broil last 2 minutes for crispier skin.',
  sourceUrl: 'https://example.com/recipe',
  timeMinutes: 45,
  kidFriendly: true,
  suitableFor: ['dinner'],
  servings: 4,
  components: [
    {
      ingredientId: ingredientResults['chicken-thigh'].id,
      quantityPerServing: 150,
      ingredient: createIngredientResult({ id: 'chicken-thigh' }),
    },
    {
      ingredientId: ingredientResults['potato'].id,
      quantityPerServing: 200,
      ingredient: createIngredientResult({ id: 'potato' }),
    },
    {
      ingredientId: ingredientResults['garlic'].id,
      quantityPerServing: 2,
      ingredient: createIngredientResult({ id: 'garlic' }),
    },
  ],
}

const importMeal: MealFormData = {
  name: 'Imported recipe — needs review',
  description: null,
  kidFriendly: false,
  suitableFor: ['dinner'],
  servings: 4,
  prefilledIngredients: [
    createUnmatchedPrefilledIngredient({
      extractedName: 'pickled daikon',
      originalText: '50g pickled daikon',
      extractedQuantity: 50,
      extractedUnit: 'g',
    }),
    createLowConfidencePrefilledIngredient(),
  ],
  originalRecipeText: '50g pickled daikon\n2 tbsp miso\n200g salmon fillet',
}

const meta = {
  title: 'Feature/Household/MealForm',
  component: MealForm,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'Custom-meal create/edit form. Composes `MealFormBasicInfo`, `ComponentList` / `IngredientRow`, `IngredientSearch`, and `MealFormDetails`. Submits via `fetch` to `/api/households/me/meals` (POST) or `/api/households/me/meals/:id` (PATCH); MSW handlers in `src/stories/msw-handlers.ts` back both endpoints.',
      },
    },
  },
  args: {
    onSuccess: fn(),
    onCancel: fn(),
  },
} satisfies Meta<typeof MealForm>

export default meta
type Story = StoryObj<typeof meta>

export const Create: Story = {
  args: {
    defaultServings: 4,
  },
  parameters: {
    docs: {
      description: {
        story: 'Empty create form — header reads "Create meal", submit button reads "Create meal".',
      },
    },
  },
}

export const Edit: Story = {
  args: {
    meal: editMeal,
  },
  parameters: {
    docs: {
      description: {
        story:
          'Edit form prefilled with an existing meal — header reads "Edit meal", submit button reads "Update meal".',
      },
    },
  },
}

export const Submitting: Story = {
  args: {
    meal: editMeal,
  },
  parameters: {
    msw: { handlers: submittingMealFormHandlers },
    docs: {
      description: {
        story:
          'PATCH never resolves — submit button stays in the "Saving..." state with all inputs disabled.',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const submitButton = await canvas.findByRole('button', { name: /update meal/i })
    await userEvent.click(submitButton)
    await canvas.findByRole('button', { name: /saving/i })
  },
}

export const WithValidationErrors: Story = {
  args: {
    meal: importMeal,
  },
  parameters: {
    docs: {
      description: {
        story:
          'Import flow with unresolved + low-confidence rows — form refuses to save until they are resolved (visual baseline; play story below covers the assertion).',
      },
    },
  },
}

// Play story — exercises the form-level validation contract. The name input
// has HTML5 `required`, so the empty-name path is enforced by the browser
// before the JS handler runs (no role="alert" rendered). Instead we type a
// name to satisfy HTML5 validation, then submit with no ingredients — the
// component's own validation surfaces "Add at least one ingredient" via the
// alert region and onSuccess never fires.

export const SubmitValidatesRequiredFields: Story = {
  args: {
    defaultServings: 4,
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    const nameInput = await canvas.findByLabelText(/meal name/i)
    await userEvent.type(nameInput, 'Test meal')

    const submitButton = await canvas.findByRole('button', { name: /create meal/i })
    await userEvent.click(submitButton)

    const errorAlert = await canvas.findByRole('alert')
    await expect(errorAlert).toHaveTextContent(/add at least one ingredient/i)
    await waitFor(() => expect(args.onSuccess).not.toHaveBeenCalled())
  },
}
