import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, fn, userEvent, within } from 'storybook/test'
import { Label } from '@/components/ui/label'
import { TagInput, type TagInputProps } from './tag-input'

interface ControlledArgs extends Omit<TagInputProps, 'value' | 'onChange'> {
  initialValue: string[]
  onChange: (value: string[]) => void
}

function ControlledTagInput({ initialValue, onChange, ...rest }: ControlledArgs) {
  const [value, setValue] = useState<string[]>(initialValue)
  return (
    <div className="max-w-md">
      <Label htmlFor={rest.id ?? 'tag-input'} className="mb-2 block">
        Allergens
      </Label>
      <TagInput
        {...rest}
        id={rest.id ?? 'tag-input'}
        value={value}
        onChange={(next) => {
          setValue(next)
          onChange(next)
        }}
      />
    </div>
  )
}

const meta = {
  title: 'UI/TagInput',
  component: ControlledTagInput,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'Controlled tag list. Enter commits the current input as a tag; Backspace on an empty input removes the last tag; duplicates are silently ignored. Used for allergens, restrictions, and excluded-ingredient lists on the member preferences form.',
      },
    },
  },
  args: {
    placeholder: 'Add and press Enter',
    initialValue: [],
    onChange: fn(),
  },
} satisfies Meta<typeof ControlledTagInput>

export default meta
type Story = StoryObj<typeof meta>

export const Empty: Story = {}

export const WithTags: Story = {
  args: {
    initialValue: ['gluten', 'dairy', 'tree nut'],
  },
}

export const Disabled: Story = {
  args: {
    disabled: true,
    initialValue: ['gluten', 'dairy'],
  },
  parameters: {
    // WHY: The container fades to 50% opacity when disabled, reducing badge
    // text contrast below 4.5:1. WCAG SC 1.4.3 exempts disabled UI components
    // from the contrast requirement — axe can't infer the disabled state from
    // the opacity class, so the waiver is rule-scoped.
    a11y: { config: { rules: [{ id: 'color-contrast', enabled: false }] } },
  },
}

export const AddTagViaEnter: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    const input = canvas.getByRole('textbox')

    await userEvent.type(input, 'sesame{Enter}')

    await expect(args.onChange).toHaveBeenCalledWith(['sesame'])
    expect(canvas.getByText('sesame')).toBeInTheDocument()
    expect(input).toHaveValue('')
  },
}

export const RemoveTagViaBackspace: Story = {
  args: {
    initialValue: ['gluten', 'dairy'],
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    const input = canvas.getByRole('textbox')

    input.focus()
    await userEvent.keyboard('{Backspace}')

    await expect(args.onChange).toHaveBeenCalledWith(['gluten'])
    expect(canvas.queryByText('dairy')).not.toBeInTheDocument()
  },
}

export const RemoveTagViaButton: Story = {
  args: {
    initialValue: ['gluten', 'dairy'],
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    const removeGluten = canvas.getByRole('button', { name: 'Remove gluten' })

    await userEvent.click(removeGluten)

    await expect(args.onChange).toHaveBeenCalledWith(['dairy'])
    expect(canvas.queryByText('gluten')).not.toBeInTheDocument()
  },
}

export const DuplicatePrevented: Story = {
  args: {
    initialValue: ['gluten'],
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    const input = canvas.getByRole('textbox')

    await userEvent.type(input, 'gluten{Enter}')

    await expect(args.onChange).not.toHaveBeenCalled()
    expect(canvas.getAllByText('gluten')).toHaveLength(1)
  },
}
