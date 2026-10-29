import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { http, HttpResponse } from 'msw'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { AddIngredientForm } from './AddIngredientForm'

const meta = {
  title: 'Feature/Recipes/AddIngredientForm',
  component: AddIngredientForm,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          '"Add as new ingredient" from an unmatched ingredient row (HON-1263). The household copies the pack label, per 100 g, and ticks the allergens. Not a `<form>`: the meal form around it is one, so Enter in a field saves here.',
      },
    },
  },
  args: {
    extractedName: 'lovage',
    onCreated: fn(),
    onCancel: fn(),
  },
} satisfies Meta<typeof AddIngredientForm>

export default meta
type Story = StoryObj<typeof meta>

type Canvas = ReturnType<typeof within>

async function choose(canvas: Canvas, combobox: string, option: string) {
  await userEvent.click(canvas.getByRole('combobox', { name: combobox }))
  await userEvent.click(await within(document.body).findByRole('option', { name: option }))
  // Radix Select holds `pointer-events: none` on the body until it has closed.
  await waitFor(() => expect(document.body.style.pointerEvents).not.toBe('none'))
}

async function fillLabel(canvas: Canvas) {
  await userEvent.type(canvas.getByLabelText('Calories, kcal'), '242')
  await userEvent.type(canvas.getByLabelText('Protein, g'), '27')
  await userEvent.type(canvas.getByLabelText('Carbs, g'), '0')
  await userEvent.type(canvas.getByLabelText('Fat, g'), '14,5')
}

export const Default: Story = {}

export const Filled: Story = {
  args: { extractedName: 'kassler' },
  parameters: {
    docs: {
      description: {
        story:
          'A protein row asks for its protein type, so the planner can badge the meal and leave it out of a vegetarian plan.',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await choose(canvas, 'Category', 'Protein')
    await choose(canvas, 'Protein type', 'Pork')
    await userEvent.click(canvas.getByRole('radio', { name: 'Pieces' }))
    await userEvent.type(canvas.getByLabelText('Grams per piece'), '120')
    await userEvent.click(canvas.getByRole('button', { name: 'Soy' }))
    await fillLabel(canvas)

    await expect(canvas.getByRole('combobox', { name: 'Protein type' })).toHaveTextContent('Pork')
    await expect(canvas.getByRole('button', { name: 'Soy' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  },
}

export const MissingValues: Story = {
  parameters: {
    docs: {
      description: {
        story: 'Save with nothing chosen marks each required field and sends nothing.',
      },
    },
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Save ingredient' }))

    await expect(canvas.getAllByRole('alert').map((alert) => alert.textContent)).toEqual([
      'Choose a category',
      'Enter a value',
      'Enter a value',
      'Enter a value',
      'Enter a value',
    ])
    await expect(args.onCreated).not.toHaveBeenCalled()
  },
}

export const RateLimited: Story = {
  parameters: {
    msw: {
      handlers: [
        http.post('/api/ingredients', () =>
          HttpResponse.json({ error: 'Rate limit exceeded' }, { status: 429 }),
        ),
      ],
    },
    docs: {
      description: {
        story: 'A 429 shows the catalog line, never the English server string.',
      },
    },
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    await choose(canvas, 'Category', 'Vegetables')
    await fillLabel(canvas)
    await userEvent.click(canvas.getByRole('button', { name: 'Save ingredient' }))

    await expect(await canvas.findByText('Too many new ingredients, try again later')).toBeVisible()
    await waitFor(() =>
      expect(canvas.getByRole('button', { name: 'Save ingredient' })).not.toHaveAttribute(
        'aria-disabled',
      ),
    )
    await expect(args.onCreated).not.toHaveBeenCalled()
  },
}
