import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, fn, userEvent, within } from 'storybook/test'
import { createMeal } from '@/stories/fixtures'
import { MealDetailModal } from './MealDetailModal'
import type { PreparationSteps } from './types'

/**
 * The cook view's ask field at 390px, in the real modal (HON-1377): a step's
 * indent leaves the Estonian field 173px for text here, and 151px on
 * `pnpm review:local`, where the issue found the old "Küsi selle sammu kohta"
 * (172px) cut off. So each placeholder must fit the narrower of the two.
 * `MealDetailModal.stories.tsx` is at its file-size cap, so these live here.
 */

const tips: PreparationSteps = {
  equipment: ['Sheet pan', 'Sharp knife'],
  steps: [
    'Heat the oven to 220°C with a rack in the upper third.',
    'Pat the chicken dry, then season it with salt, pepper and a little olive oil.',
  ],
  pitfalls: [],
}

const meta = {
  title: 'Meal plan/MealDetailModal/Ask field fit',
  component: MealDetailModal,
  parameters: { layout: 'fullscreen' },
  globals: { viewport: { value: 'mobileIphone', isRotated: false } },
  args: {
    meal: createMeal(),
    householdServings: 4,
    open: true,
    onOpenChange: fn(),
    planId: 'plan-1',
    entryId: 'entry-1',
    status: 'planned',
    generateOnOpen: true,
    initialSteps: tips,
    onDoneCooking: fn(),
  },
} satisfies Meta<typeof MealDetailModal>

export default meta
type Story = StoryObj<typeof meta>

const body = () => within(document.body)

/** The narrowest content box the issue measured for the field at 390px. */
const NARROWEST_FIELD = 151

/**
 * The field's placeholder shows in full: its text, in the field's font, is no
 * wider than the field's content box, nor than `NARROWEST_FIELD`.
 * `scrollWidth` does not see a placeholder, so this measures it on a canvas.
 */
async function expectPlaceholderFits(field: HTMLInputElement, placeholder: string) {
  await expect(field).toHaveAttribute('placeholder', placeholder)
  await document.fonts.ready
  const style = getComputedStyle(field)
  const ctx = document.createElement('canvas').getContext('2d')!
  ctx.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
  ctx.letterSpacing = style.letterSpacing === 'normal' ? '0px' : style.letterSpacing
  const inner = field.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
  await expect(ctx.measureText(placeholder).width).toBeLessThanOrEqual(
    Math.min(inner, NARROWEST_FIELD),
  )
}

/** Open a row's panel with "Ask your own question", then check its field. */
async function expectPanelFits(rowName: string, askOwn: string, placeholder: string) {
  await userEvent.click(await body().findByRole('button', { name: rowName }))
  await userEvent.click(await body().findByRole('menuitem', { name: askOwn }))
  const panel = await body().findByRole('group', { name: rowName })
  await expectPlaceholderFits(within(panel).getByRole<HTMLInputElement>('textbox'), placeholder)
}

/** "Küsi sammu kohta" and "Küsi vahendi kohta" show in full (HON-1377). */
export const Estonian: Story = {
  globals: { locale: 'et' },
  play: async () => {
    await expectPanelFits('Küsi sammu 2 kohta', 'Küsi oma küsimus', 'Küsi sammu kohta')
    await expectPanelFits('Küsi vahendi kohta: Sheet pan', 'Küsi oma küsimus', 'Küsi vahendi kohta')
  },
}

/** The English placeholders fit too. */
export const English: Story = {
  play: async () => {
    await expectPanelFits('Ask about step 2', 'Ask your own question', 'Ask about this step')
    await expectPanelFits('Ask about Sheet pan', 'Ask your own question', 'Ask about this item')
  },
}
