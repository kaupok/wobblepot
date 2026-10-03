import { describe, it, expect, vi } from 'vitest'

// The global next-intl mock does not format `{multiplier, number}`; the real
// provider does, and the chip labels are what these tests read.
vi.unmock('next-intl')
import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NextIntlClientProvider } from 'next-intl'
import enMessages from '../../../messages/en.json'
import { PortionSizeField, isValidPortion } from './PortionSizeField'

function Harness({
  initial,
  onChange,
}: {
  initial: number | null
  onChange: (v: number | null) => void
}) {
  const [value, setValue] = useState(initial)
  return (
    <PortionSizeField
      labelId="portion-label"
      value={value}
      onValueChange={(next) => {
        setValue(next)
        onChange(next)
      }}
    />
  )
}

function renderField(initial: number | null) {
  const onChange = vi.fn()
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <Harness initial={initial} onChange={onChange} />
    </NextIntlClientProvider>,
  )
  return { onChange }
}

const input = () => screen.queryByRole('textbox', { name: 'Portion multiplier' })
const radio = (name: string | RegExp) => screen.getByRole('radio', { name })

describe('PortionSizeField', () => {
  it('names the chip group and labels the presets with ×', () => {
    renderField(1)
    expect(screen.getByRole('radiogroup', { name: 'Portion size' })).toBeInTheDocument()
    expect(radio('Small (0.75×)')).toBeInTheDocument()
    expect(radio('Extra large (2×)')).toBeInTheDocument()
  })

  it('checks the preset and hides the input for a preset value', () => {
    renderField(1.5)
    expect(radio('Large (1.5×)')).toHaveAttribute('aria-checked', 'true')
    expect(input()).not.toBeInTheDocument()
  })

  it('opens on Custom with the input for a value that matches no preset', () => {
    renderField(1.25)
    expect(radio('Custom')).toHaveAttribute('aria-checked', 'true')
    expect(input()).toHaveValue('1.25')
  })

  it('shows the input with the current value when Custom is picked, without changing it', async () => {
    const { onChange } = renderField(0.75)
    await userEvent.click(radio('Custom'))
    expect(input()).toHaveValue('0.75')
    expect(radio('Custom')).toHaveFocus()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('keeps Custom while the typed value equals a preset', async () => {
    const { onChange } = renderField(1.25)
    await userEvent.clear(input()!)
    await userEvent.type(input()!, '2')
    expect(onChange).toHaveBeenLastCalledWith(2)
    expect(radio('Custom')).toHaveAttribute('aria-checked', 'true')
    expect(input()).toHaveValue('2')
  })

  it('hides the input and sets the value when a preset is picked', async () => {
    const { onChange } = renderField(1.25)
    await userEvent.click(radio('Small (0.75×)'))
    expect(onChange).toHaveBeenCalledWith(0.75)
    expect(input()).not.toBeInTheDocument()
  })

  it('renders the error and marks the input invalid', () => {
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <PortionSizeField labelId="l" value={4} onValueChange={vi.fn()} error="Out of range" />
      </NextIntlClientProvider>,
    )
    expect(screen.getByRole('alert')).toHaveTextContent('Out of range')
    expect(input()).toHaveAttribute('aria-invalid', 'true')
    expect(input()).toHaveAccessibleDescription('Out of range')
  })
})

describe('isValidPortion', () => {
  it('accepts 0.5 to 3.0 and rejects empty or out-of-range values', () => {
    expect(isValidPortion(0.5)).toBe(true)
    expect(isValidPortion(3)).toBe(true)
    expect(isValidPortion(0.4)).toBe(false)
    expect(isValidPortion(3.1)).toBe(false)
    expect(isValidPortion(null)).toBe(false)
  })
})
