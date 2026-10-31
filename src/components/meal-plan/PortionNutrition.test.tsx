import { beforeEach, describe, expect, it, vi } from 'vitest'
// The real provider, so the multiplier is formatted for the locale (1,5 in Estonian).
vi.unmock('next-intl')
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NextIntlClientProvider } from 'next-intl'
import type { ReactNode } from 'react'

import type { MemberPortion } from '@/hooks/use-member-portions'
import { stubPointerApis } from '@/test/household-settings'

import enMessages from '../../../messages/en.json'
import etMessages from '../../../messages/et.json'
import { PortionNutrition } from './PortionNutrition'

// The trout dinner from the issue: 38 g protein per serving.
const trout = { calories: 520, protein: 38, carbs: 30, fat: 22 }

const kaupo: MemberPortion = { id: 'm1', name: 'Kaupo', multiplier: 1.5, isSelf: false }
const mari: MemberPortion = { id: 'm2', name: 'Mari', multiplier: 1, isSelf: false }
const nora: MemberPortion = { id: 'm3', name: 'Nora', multiplier: 0.5, isSelf: false }

function renderInLocale(node: ReactNode, locale: 'en' | 'et' = 'en') {
  const messages = locale === 'et' ? etMessages : enMessages
  return render(
    <NextIntlClientProvider locale={locale} messages={messages}>
      {node}
    </NextIntlClientProvider>,
  )
}

/** Opens the caption's list and picks one option. */
async function pick(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(screen.getByRole('combobox'))
  await user.click(await screen.findByRole('option', { name }))
}

describe('PortionNutrition', () => {
  beforeEach(() => {
    stubPointerApis()
  })

  it('shows no portion chips', () => {
    renderInLocale(<PortionNutrition nutrition={trout} portions={[kaupo, mari, nora]} />)
    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument()
    expect(screen.queryByRole('radio')).not.toBeInTheDocument()
  })

  it('lists "Per serving", then one option per member in order', async () => {
    const user = userEvent.setup()
    renderInLocale(<PortionNutrition nutrition={trout} portions={[kaupo, mari, nora]} />)
    await user.click(screen.getByRole('combobox', { name: 'Whose portion per serving' }))
    const options = await screen.findAllByRole('option')
    expect(options.map((option) => option.textContent)).toEqual([
      'Per serving',
      'Kaupo 1.5×',
      'Mari 1×',
      'Nora 0.5×',
    ])
    expect(screen.getByRole('option', { name: 'Per serving' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
  })

  it('opens on "Per serving" when the signed-in member is not in the list', () => {
    renderInLocale(<PortionNutrition nutrition={trout} portions={[kaupo, mari, nora]} />)
    expect(screen.getByRole('combobox')).toHaveTextContent('per serving')
    // The chevron after the caption says it opens.
    expect(screen.getByRole('combobox').querySelector('svg.lucide-chevron-down')).not.toBeNull()
    expect(screen.getByText('38g')).toBeInTheDocument()
  })

  it("multiplies every value by the selected member's portion", async () => {
    const user = userEvent.setup()
    renderInLocale(<PortionNutrition nutrition={trout} portions={[kaupo, mari, nora]} />)

    await pick(user, 'Kaupo 1.5×')
    expect(screen.getByText('780 kcal')).toBeInTheDocument()
    expect(screen.getByText('57g')).toBeInTheDocument()
    expect(screen.getByText('45g')).toBeInTheDocument()
    expect(screen.getByText('33g')).toBeInTheDocument()
    expect(
      screen.getByRole('combobox', { name: 'Whose portion Kaupo, 1.5× portion' }),
    ).toBeVisible()

    await pick(user, 'Nora 0.5×')
    expect(screen.getByText('260 kcal')).toBeInTheDocument()
    expect(screen.getByText('19g')).toBeInTheDocument()
    expect(screen.getByText('15g')).toBeInTheDocument()
    expect(screen.getByText('11g')).toBeInTheDocument()
    expect(screen.getByRole('combobox')).toHaveTextContent('Nora, 0.5× portion')

    await pick(user, 'Per serving')
    expect(screen.getByText('520 kcal')).toBeInTheDocument()
    expect(screen.getByText('38g')).toBeInTheDocument()
    expect(screen.getByRole('combobox')).toHaveTextContent('per serving')
  })

  it('multiplies the unrounded values, then rounds', () => {
    // 10.4 g rounds to 10 g, but 10.4 × 1.5 = 15.6 g rounds to 16 g, not 15.
    renderInLocale(
      <PortionNutrition
        nutrition={{ calories: 300, protein: 10.4, carbs: 20, fat: 5 }}
        portions={[{ ...kaupo, isSelf: true }, mari]}
      />,
    )
    expect(screen.getByText('16g')).toBeInTheDocument()
  })

  it("opens on the signed-in member's portion when it is 1.5×", () => {
    renderInLocale(
      <PortionNutrition nutrition={trout} portions={[{ ...kaupo, isSelf: true }, mari, nora]} />,
    )
    expect(screen.getByRole('combobox')).toHaveTextContent('Kaupo, 1.5× portion')
    expect(screen.getByText('57g')).toBeInTheDocument()
  })

  it('opens on "Per serving" when the signed-in member is at 1×', () => {
    renderInLocale(
      <PortionNutrition nutrition={trout} portions={[kaupo, { ...mari, isSelf: true }, nora]} />,
    )
    expect(screen.getByRole('combobox')).toHaveTextContent('per serving')
    expect(screen.getByText('38g')).toBeInTheDocument()
  })

  it('moves through the options with the keyboard', async () => {
    const user = userEvent.setup()
    renderInLocale(<PortionNutrition nutrition={trout} portions={[kaupo, mari, nora]} />)

    await user.tab()
    expect(screen.getByRole('combobox')).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(await screen.findByRole('option', { name: 'Per serving' })).toHaveFocus()
    await user.keyboard('{ArrowDown}')
    expect(screen.getByRole('option', { name: 'Kaupo 1.5×' })).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(screen.getByText('57g')).toBeInTheDocument()

    await user.keyboard(' ')
    expect(await screen.findByRole('option', { name: 'Kaupo 1.5×' })).toHaveFocus()
  })

  it('shows plain, unfocusable text when every member is at 1×', async () => {
    const user = userEvent.setup()
    renderInLocale(
      <PortionNutrition
        nutrition={trout}
        portions={[
          { ...mari, isSelf: true },
          { ...mari, id: 'm4', name: 'Jaan' },
        ]}
      />,
    )
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    expect(screen.getByText('per serving')).toBeInTheDocument()
    expect(document.querySelector('svg.lucide-chevron-down')).toBeNull()
    expect(screen.getByText('38g')).toBeInTheDocument()
    await user.tab()
    expect(document.body).toHaveFocus()
  })

  it('shows plain text without members', () => {
    renderInLocale(<PortionNutrition nutrition={trout} />)
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    expect(screen.getByText('per serving')).toBeInTheDocument()
  })

  it('formats the multiplier and the captions for Estonian', async () => {
    const user = userEvent.setup()
    renderInLocale(<PortionNutrition nutrition={trout} portions={[kaupo, mari, nora]} />, 'et')
    expect(screen.getByRole('combobox', { name: 'Kelle portsjon portsjoni kohta' })).toBeVisible()

    await pick(user, 'Nora 0,5×')
    expect(screen.getByRole('combobox')).toHaveTextContent('Nora, 0,5× portsjon')
    expect(screen.getByText('19g')).toBeInTheDocument()

    await pick(user, 'Portsjoni kohta')
    expect(screen.getByRole('combobox')).toHaveTextContent('portsjoni kohta')
    expect(screen.getByText('38g')).toBeInTheDocument()
  })
})
