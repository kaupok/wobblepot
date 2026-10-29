// Use the real next-intl in this file: the global mock in vitest.setup.ts
// renders English only, and this suite checks the Estonian tile.
import { describe, expect, it, vi } from 'vitest'
vi.unmock('next-intl')
import { render, screen, within } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'

import enMessages from '../../../messages/en.json'
import etMessages from '../../../messages/et.json'
import { LandingConnect } from './LandingConnect'

function renderConnect(locale: 'en' | 'et' = 'en') {
  const messages = locale === 'et' ? etMessages : enMessages
  return render(
    <NextIntlClientProvider locale={locale} messages={messages} timeZone="Europe/Tallinn">
      <ul>
        <LandingConnect />
      </ul>
    </NextIntlClientProvider>,
  )
}

function drawing(vignette: 'assistant' | 'screen') {
  const el = screen.getByTestId(`landing-vignette-${vignette}`).querySelector('[inert]')
  if (!(el instanceof HTMLElement)) throw new Error(`no inert drawing in ${vignette}`)
  return el
}

describe('LandingConnect', () => {
  it('names the assistant and the read-only key', () => {
    renderConnect()
    expect(screen.getByRole('heading', { level: 3, name: 'Ask your AI assistant' })).toHaveClass(
      'font-display',
    )
    expect(screen.getByText(/Connect Claude or another assistant/)).toBeInTheDocument()
    expect(screen.getByText(/A read-only key puts the week/)).toBeInTheDocument()
  })

  it('shows a read, then a write, each after the Wobblepot call that served it', () => {
    renderConnect()
    const chat = drawing('assistant')
    const lines = [
      "What's for dinner on Friday?",
      'Wobblepot · Read the meal plan',
      'Homemade pizza, about 50 minutes. Mozzarella and basil are still on the shopping list.',
      'We bought the mozzarella.',
      'Wobblepot · Mark as bought',
      'Done. Only the basil is left to buy.',
    ]
    const nodes = lines.map((line) => within(chat).getByText(line))
    for (let i = 1; i < nodes.length; i++) {
      expect(
        nodes[i - 1]!.compareDocumentPosition(nodes[i]!) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy()
    }
  })

  it("shows the week strip's Friday to Sunday on the kitchen screen, and the basil left to buy", () => {
    renderConnect()
    const kitchen = drawing('screen')
    const rows = within(kitchen).getAllByRole('listitem')
    expect(rows.map((row) => row.textContent)).toEqual([
      'FriHomemade pizza50 min',
      'SatBeef stew with potatoes90 min',
      'SunRoast chicken with vegetables80 min',
    ])
    expect(within(kitchen).getByText('Basil')).toBeInTheDocument()
  })

  it('makes both vignettes inert, with a caption outside the inert part', () => {
    renderConnect()
    for (const vignette of ['assistant', 'screen'] as const) {
      const figure = screen.getByTestId(`landing-vignette-${vignette}`)
      expect(figure.tagName).toBe('FIGURE')
      expect(drawing(vignette)).toHaveAttribute('inert')
      const caption = figure.querySelector('figcaption')
      expect(caption).toHaveClass('sr-only')
      expect(caption?.closest('[inert]')).toBeNull()
    }
    expect(drawing('assistant').querySelector('.font-display')).toBeNull()
  })

  it('renders in Estonian', () => {
    renderConnect('et')
    screen.getByRole('heading', { level: 3, name: 'Küsi oma AI-assistendilt' })
    expect(within(drawing('assistant')).getByText('Mis reedel õhtuks on?')).toBeInTheDocument()
    const rows = within(drawing('screen')).getAllByRole('listitem')
    expect(rows[0]).toHaveTextContent('Kodune pitsa')
    expect(rows[0]).toHaveTextContent('R')
  })
})
