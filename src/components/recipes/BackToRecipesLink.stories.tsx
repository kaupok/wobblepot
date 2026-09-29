import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, within } from 'storybook/test'
import { Heading } from '@/components/ui/typography'
import { BackToRecipesLink, BackToRecipesLinkSkeleton } from './BackToRecipesLink'

const meta = {
  title: 'Feature/Recipes/BackToRecipesLink',
  component: BackToRecipesLink,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'The back arrow beside the `h1` on `/recipes/create`, `/recipes/[id]/edit`, `/recipes/imagine` and `/recipes/import`. A plain link to `/recipes` named "Back to recipes". `BackToRecipesLinkSkeleton` holds its place in the loading skeletons.',
      },
    },
  },
} satisfies Meta<typeof BackToRecipesLink>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const link = within(canvasElement).getByRole('link', { name: 'Back to recipes' })
    await expect(link).toHaveAttribute('href', '/recipes')
    const { width, height } = link.getBoundingClientRect()
    await expect(width).toBeGreaterThanOrEqual(32)
    await expect(height).toBeGreaterThanOrEqual(32)
  },
}

/** As the pages use it: to the left of the `h1`. */
export const InTitleRow: Story = {
  render: () => (
    <div className="flex items-center gap-2">
      <BackToRecipesLink />
      <Heading variant="h4" as="h1">
        Create meal
      </Heading>
    </div>
  ),
}

/** The skeleton title row, for comparison with `InTitleRow`. */
export const Loading: Story = {
  render: () => (
    <div className="flex h-8 items-center gap-2">
      <BackToRecipesLinkSkeleton />
    </div>
  ),
}
