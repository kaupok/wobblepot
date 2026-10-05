import { describe, it, expect, vi } from 'vitest'
// The real provider, so the ICU messages ("Serves {count}. Click to edit.")
// render as they do in the app.
vi.unmock('next-intl')
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NextIntlClientProvider } from 'next-intl'
import enMessages from '../../../messages/en.json'
import etMessages from '../../../messages/et.json'
import { ServingControl } from './ServingControl'

function renderControl(
  props: Partial<React.ComponentProps<typeof ServingControl>> = {},
  locale: 'en' | 'et' = 'en',
) {
  const onServingsChange = vi.fn(async () => true)
  const utils = render(
    <NextIntlClientProvider locale={locale} messages={locale === 'en' ? enMessages : etMessages}>
      <ServingControl
        servings={4}
        householdServings={4}
        onServingsChange={onServingsChange}
        {...props}
      />
    </NextIntlClientProvider>,
  )
  return { ...utils, onServingsChange }
}

const pencil = (container: HTMLElement) => container.querySelector('svg.lucide-pencil')

describe('ServingControl', () => {
  it('names the button by its count only, with the pencil hidden from it', () => {
    const { container } = renderControl()
    const button = screen.getByRole('button', { name: 'Serves 4. Click to edit.' })
    expect(button).toHaveTextContent('Serves 4')
    expect(pencil(container)).toHaveAttribute('aria-hidden', 'true')
  })

  it('shows the custom marker and the pencil when servings are overridden', () => {
    const { container } = renderControl({ servings: 6 })
    expect(screen.getByRole('button', { name: 'Serves 6. Click to edit.' })).toHaveTextContent(
      'Serves 6(custom)',
    )
    expect(pencil(container)).toBeInTheDocument()
  })

  it('is disabled and shows no pencil when disabled', () => {
    const { container } = renderControl({ disabled: true })
    expect(screen.getByRole('button', { name: 'Serves 4. Click to edit.' })).toBeDisabled()
    expect(pencil(container)).not.toBeInTheDocument()
  })

  it('opens a focused number field without the pencil, and saves on Enter', async () => {
    const user = userEvent.setup()
    const { container, onServingsChange } = renderControl()
    await user.click(screen.getByRole('button', { name: 'Serves 4. Click to edit.' }))

    const input = screen.getByRole('textbox', { name: 'Number of servings' })
    expect(input).toHaveFocus()
    expect(pencil(container)).not.toBeInTheDocument()

    await user.clear(input)
    await user.type(input, '6{Enter}')
    expect(onServingsChange).toHaveBeenCalledWith(6)
    expect(await screen.findByRole('button', { name: 'Serves 4. Click to edit.' })).toBeVisible()
  })

  it('clears the override when set back to the household servings', async () => {
    const user = userEvent.setup()
    const { onServingsChange } = renderControl({ servings: 6 })
    await user.click(screen.getByRole('button', { name: 'Serves 6. Click to edit.' }))
    const input = screen.getByRole('textbox', { name: 'Number of servings' })
    await user.clear(input)
    await user.type(input, '4{Enter}')
    expect(onServingsChange).toHaveBeenCalledWith(null)
  })

  it('cancels on Escape without saving', async () => {
    const user = userEvent.setup()
    const { onServingsChange } = renderControl()
    await user.click(screen.getByRole('button', { name: 'Serves 4. Click to edit.' }))
    await user.type(screen.getByRole('textbox', { name: 'Number of servings' }), '9{Escape}')
    expect(onServingsChange).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Serves 4. Click to edit.' })).toBeInTheDocument()
  })

  // Two adults and a toddler at 0.5× cook for 2.5 servings (HON-1040).
  describe('with fractional household servings', () => {
    const household = { servings: 2.5, householdServings: 2.5 }

    it('shows the fraction, not the member count', () => {
      renderControl(household)
      expect(screen.getByRole('button', { name: 'Serves 2.5. Click to edit.' })).toHaveTextContent(
        /^Serves 2\.5$/,
      )
    })

    it('shows an Estonian decimal comma', () => {
      renderControl(household, 'et')
      expect(
        screen.getByRole('button', { name: '2,5 portsjonit. Klõpsa, et muuta.' }),
      ).toHaveTextContent(/^2,5 portsjonit$/)
    })

    it('opens the field on the locale-formatted value', async () => {
      const user = userEvent.setup()
      renderControl(household, 'et')
      await user.click(screen.getByRole('button', { name: '2,5 portsjonit. Klõpsa, et muuta.' }))
      expect(screen.getByRole('textbox')).toHaveValue('2,5')
    })

    it('saves a typed whole number as an override', async () => {
      const user = userEvent.setup()
      const { onServingsChange } = renderControl(household)
      await user.click(screen.getByRole('button', { name: 'Serves 2.5. Click to edit.' }))
      const input = screen.getByRole('textbox', { name: 'Number of servings' })
      await user.clear(input)
      await user.type(input, '3{Enter}')
      expect(onServingsChange).toHaveBeenCalledWith(3)
    })

    it('clears an override when the household value is typed back, fraction included', async () => {
      const user = userEvent.setup()
      const { onServingsChange } = renderControl({ servings: 4, householdServings: 2.5 }, 'et')
      await user.click(screen.getByRole('button', { name: /^4 portsjonit/ }))
      const input = screen.getByRole('textbox')
      await user.clear(input)
      await user.type(input, '2,5{Enter}')
      expect(onServingsChange).toHaveBeenCalledWith(null)
    })

    it('rejects any other fraction, because an override is whole', async () => {
      const user = userEvent.setup()
      const { onServingsChange } = renderControl({ servings: 4, householdServings: 2.5 })
      await user.click(screen.getByRole('button', { name: 'Serves 4. Click to edit.' }))
      const input = screen.getByRole('textbox', { name: 'Number of servings' })
      await user.clear(input)
      await user.type(input, '3.5{Enter}')
      expect(onServingsChange).not.toHaveBeenCalled()
      expect(await screen.findByRole('button', { name: 'Serves 4. Click to edit.' })).toBeVisible()
    })

    it('saves nothing when the field is left on the fraction', async () => {
      const user = userEvent.setup()
      const { onServingsChange } = renderControl(household)
      await user.click(screen.getByRole('button', { name: 'Serves 2.5. Click to edit.' }))
      await user.keyboard('{Enter}')
      expect(onServingsChange).not.toHaveBeenCalled()
      expect(
        await screen.findByRole('button', { name: 'Serves 2.5. Click to edit.' }),
      ).toBeVisible()
    })
  })
})
