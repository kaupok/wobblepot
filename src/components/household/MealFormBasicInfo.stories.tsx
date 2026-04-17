import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { fn } from 'storybook/test'
import { MealFormBasicInfo } from './MealFormBasicInfo'

const meta = {
  title: 'Feature/Household/MealFormBasicInfo',
  component: MealFormBasicInfo,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'First section of the meal form — name, description, and servings. Pure controlled inputs that forward changes to the parent. Validation lives in `MealForm`, not here.',
      },
    },
  },
  args: {
    name: '',
    description: '',
    servings: '4',
    disabled: false,
    onNameChange: fn(),
    onDescriptionChange: fn(),
    onServingsChange: fn(),
  },
} satisfies Meta<typeof MealFormBasicInfo>

export default meta
type Story = StoryObj<typeof meta>

// WHY: This component is a thin controlled-input wrapper with no callbacks
// worth regression-testing — every state change goes straight back to the
// parent via on*Change props. Validation, submission, and side effects live
// in `MealForm`, which has its own play story.

export const Default: Story = {
  parameters: {
    docs: {
      description: {
        story: 'Empty inputs with the default 4-serving value — matches the create-mode baseline.',
      },
    },
  },
}

export const WithAllFields: Story = {
  args: {
    name: 'Lemon-garlic roast chicken',
    description: 'Weeknight-friendly sheet-pan dinner with crisp skin and bright citrus.',
    servings: '6',
  },
  parameters: {
    docs: {
      description: {
        story:
          'All three inputs filled — represents the edit-mode baseline before further changes.',
      },
    },
  },
}

export const Disabled: Story = {
  args: {
    name: 'Lemon-garlic roast chicken',
    description: 'Weeknight-friendly sheet-pan dinner with crisp skin and bright citrus.',
    servings: '4',
    disabled: true,
  },
  parameters: {
    docs: {
      description: {
        story:
          'All inputs disabled — used while a meal mutation is in flight, so styling needs to read clearly as "submitting".',
      },
    },
  },
}
