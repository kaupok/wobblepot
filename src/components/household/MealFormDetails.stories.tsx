import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { MealFormDetails } from './MealFormDetails'
import type { MainProteinState } from './use-main-protein'

/** One protein type in the ingredients: no choice to make, so no select. */
const singleProtein: MainProteinState = {
  visible: false,
  options: ['poultry'],
  automatic: 'poultry',
  choice: null,
  setChoice: fn(),
}

const meta = {
  title: 'Feature/Household/MealFormDetails',
  component: MealFormDetails,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'Second section of the meal form — meal-type checkboxes (breakfast/lunch/dinner), prep time, kid-friendly toggle, and the "Main protein" select when the ingredients carry two or more protein types (HON-1386). Controlled inputs only; toggle logic lives in `MealForm`, the protein choice in `useMainProtein`.',
      },
    },
  },
  args: {
    suitableFor: ['dinner'],
    timeMinutes: '45',
    kidFriendly: false,
    disabled: false,
    onMealTypeToggle: fn(),
    onTimeMinutesChange: fn(),
    onKidFriendlyChange: fn(),
    mainProtein: singleProtein,
  },
} satisfies Meta<typeof MealFormDetails>

export default meta
type Story = StoryObj<typeof meta>

// WHY: Same as MealFormBasicInfo — controlled inputs forward every change to
// the parent. The interesting logic (only-one-meal-type-selectable etc.)
// lives in `MealForm`'s `handleMealTypeToggle`, which has its own coverage.

export const Default: Story = {
  parameters: {
    docs: {
      description: {
        story:
          'Dinner only, 45 min, kid-friendly off — the canonical dinner-recipe starting point.',
      },
    },
  },
}

export const WithAllSelections: Story = {
  args: {
    suitableFor: ['breakfast', 'lunch', 'dinner'],
    timeMinutes: '20',
    kidFriendly: true,
  },
  parameters: {
    docs: {
      description: {
        story: 'All meal types checked, kid-friendly on, 20-minute prep — the maximal selection.',
      },
    },
  },
}

export const Disabled: Story = {
  args: {
    suitableFor: ['lunch', 'dinner'],
    timeMinutes: '30',
    kidFriendly: true,
    disabled: true,
  },
  parameters: {
    docs: {
      description: {
        story: 'All controls disabled — used while the meal mutation is in flight.',
      },
    },
  },
}

export const MainProteinChoice: Story = {
  args: {
    mainProtein: {
      visible: true,
      options: ['beef', 'legume'],
      automatic: 'legume',
      choice: null,
      setChoice: fn(),
    },
  },
  parameters: {
    docs: {
      description: {
        story:
          'Beef mince with kidney beans: the beans carry more protein, so automatic reads "Legumes (automatic)". Choosing Beef hands it to the form.',
      },
    },
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    const select = canvas.getByRole('combobox', { name: 'Main protein' })
    await expect(select).toHaveTextContent('Legumes (automatic)')

    await userEvent.click(select)
    const listbox = within(canvasElement.ownerDocument.body).getByRole('listbox')
    await expect(
      within(listbox)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['Legumes (automatic)', 'Beef', 'Legumes'])
    await userEvent.click(within(listbox).getByRole('option', { name: 'Beef' }))
    await expect(args.mainProtein.setChoice).toHaveBeenCalledWith('beef')
    // The axe gate runs after play; let the closing listbox leave the page.
    await waitFor(() =>
      expect(within(canvasElement.ownerDocument.body).queryByRole('listbox')).toBeNull(),
    )
  },
}

export const MainProteinChosen: Story = {
  args: {
    mainProtein: {
      visible: true,
      options: ['beef', 'legume'],
      automatic: 'legume',
      choice: 'beef',
      setChoice: fn(),
    },
  },
  parameters: {
    docs: {
      description: {
        story: 'A saved choice of Beef, as the edit form reopens it.',
      },
    },
  },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByRole('combobox', { name: 'Main protein' }),
    ).toHaveTextContent('Beef')
  },
}
