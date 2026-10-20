import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { http, HttpResponse, delay } from 'msw'
import { expect, fireEvent, userEvent, waitFor, within } from 'storybook/test'
import { RecipeImportClient } from './RecipeImportClient'

/** A 1×1 PNG, so the preview thumbnail renders a real image. */
const PIXEL_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='

function recipePhoto(name = 'soup-card.png') {
  const bytes = Uint8Array.from(atob(PIXEL_PNG), (c) => c.charCodeAt(0))
  return new File([bytes], name, { type: 'image/png' })
}

/**
 * Attach photos through the hidden file input inside `AttachImages`. The
 * input is `display: none`, so `userEvent.upload` cannot click it; a change
 * event with `files` set is what the browser fires after the picker closes.
 */
function attach(canvasElement: HTMLElement, ...files: File[]) {
  const input = canvasElement.querySelector<HTMLInputElement>('input[type="file"]')!
  fireEvent.change(input, { target: { files } })
}

const parsePending = [
  http.post('/api/recipes/parse', async () => {
    await delay('infinite')
    return HttpResponse.json({ success: true })
  }),
]

const photoNoRecipe = [
  http.post('/api/recipes/parse', () =>
    HttpResponse.json(
      // `error` is the route's English prose for logs; the page renders the
      // catalog copy for `code`.
      { success: false, error: "Couldn't find a recipe in the photos.", code: 'photo_no_recipe' },
      { status: 400 },
    ),
  ),
]

const meta = {
  title: 'Feature/RecipeImportClient',
  component: RecipeImportClient,
  tags: ['autodocs'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'The `/recipes/import` page client, headed "Add recipe". Text, a link, or up to three photos of a recipe in; the parsed recipe goes to the create form through `sessionStorage["prefilled-meal"]`. `/api/recipes/parse` is served by per-story MSW handlers.',
      },
    },
  },
} satisfies Meta<typeof RecipeImportClient>

export default meta
type Story = StoryObj<typeof meta>

export const Idle: Story = {
  parameters: {
    docs: {
      description: {
        story: 'Empty page — Import recipe is disabled until text or a photo is added.',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('button', { name: 'Import recipe' })).toBeDisabled()
    await expect(canvas.getByRole('button', { name: 'Add a photo of a recipe' })).toBeEnabled()
  },
}

export const OnePhotoAttached: Story = {
  parameters: {
    docs: {
      description: {
        story:
          'One photo of a recipe attached and no text. The thumbnail has a remove button, and Import recipe is enabled.',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    attach(canvasElement, recipePhoto())

    await expect(await canvas.findByRole('img', { name: 'soup-card.png' })).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Remove soup-card.png' })).toBeEnabled()
    await expect(canvas.getByRole('button', { name: 'Import recipe' })).toBeEnabled()
  },
}

export const ReadingPhoto: Story = {
  parameters: {
    msw: { handlers: parsePending },
    docs: {
      description: {
        story: 'A photo import in flight — the first progress step is "Reading the photo".',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    attach(canvasElement, recipePhoto())
    await userEvent.click(await canvas.findByRole('button', { name: 'Import recipe' }))

    await expect(await canvas.findByText('Reading the photo…')).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Cancel' })).toBeVisible()
  },
}

export const PhotoWithNoRecipe: Story = {
  parameters: {
    msw: { handlers: photoNoRecipe },
    docs: {
      description: {
        story: 'A photo of a plated dish: no recipe to copy, so the page points to Imagine a meal.',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    attach(canvasElement, recipePhoto('dish.png'))
    await userEvent.click(await canvas.findByRole('button', { name: 'Import recipe' }))

    await waitFor(() =>
      expect(canvas.getByText(/We could not find a recipe in the photo/)).toBeVisible(),
    )
    await expect(canvas.getByRole('link', { name: 'Imagine a meal' })).toHaveAttribute(
      'href',
      '/recipes/imagine',
    )
  },
}
