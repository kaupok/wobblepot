import { describe, expect, it, vi } from 'vitest'
// The real provider, so the multiplier is formatted for the locale (1,5 in Estonian).
vi.unmock('next-intl')
import { fireEvent, render, screen } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import type { ReactNode } from 'react'

import type { MemberPortion } from '@/hooks/use-member-portions'

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

describe('PortionNutrition', () => {
  it('shows a "Per serving" chip, then one chip per member in order', () => {
    renderInLocale(<PortionNutrition nutrition={trout} portions={[kaupo, mari, nora]} />)
    const group = screen.getByRole('radiogroup', { name: 'Whose portion' })
    expect(group).toBeInTheDocument()
    expect(screen.getAllByRole('radio').map((chip) => chip.textContent)).toEqual([
      'Per serving',
      'Kaupo 1.5×',
      'Mari 1×',
      'Nora 0.5×',
    ])
  })

  it('opens on "Per serving" when the signed-in member is not in the list', () => {
    renderInLocale(<PortionNutrition nutrition={trout} portions={[kaupo, mari, nora]} />)
    expect(screen.getByRole('radio', { name: 'Per serving' })).toBeChecked()
    expect(screen.getByText('38g')).toBeInTheDocument()
    expect(screen.getByText('per serving')).toBeInTheDocument()
  })

  it("multiplies every value by the selected member's portion", () => {
    renderInLocale(<PortionNutrition nutrition={trout} portions={[kaupo, mari, nora]} />)

    fireEvent.click(screen.getByRole('radio', { name: 'Kaupo 1.5×' }))
    expect(screen.getByText('780 kcal')).toBeInTheDocument()
    expect(screen.getByText('57g')).toBeInTheDocument()
    expect(screen.getByText('45g')).toBeInTheDocument()
    expect(screen.getByText('33g')).toBeInTheDocument()
    expect(screen.getByText('Kaupo, 1.5× portion')).toBeInTheDocument()
    expect(screen.queryByText('per serving')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('radio', { name: 'Nora 0.5×' }))
    expect(screen.getByText('260 kcal')).toBeInTheDocument()
    expect(screen.getByText('19g')).toBeInTheDocument()
    expect(screen.getByText('15g')).toBeInTheDocument()
    expect(screen.getByText('11g')).toBeInTheDocument()
    expect(screen.getByText('Nora, 0.5× portion')).toBeInTheDocument()
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

  it("opens on the signed-in member's chip when their portion is 1.5×", () => {
    renderInLocale(
      <PortionNutrition nutrition={trout} portions={[{ ...kaupo, isSelf: true }, mari, nora]} />,
    )
    expect(screen.getByRole('radio', { name: 'Kaupo 1.5×' })).toBeChecked()
    expect(screen.getByText('57g')).toBeInTheDocument()
  })

  it('opens on "Per serving" when the signed-in member is at 1×', () => {
    renderInLocale(
      <PortionNutrition nutrition={trout} portions={[kaupo, { ...mari, isSelf: true }, nora]} />,
    )
    expect(screen.getByRole('radio', { name: 'Per serving' })).toBeChecked()
    expect(screen.getByText('38g')).toBeInTheDocument()
  })

  it('shows no chips when every member is at 1×', () => {
    renderInLocale(
      <PortionNutrition
        nutrition={trout}
        portions={[
          { ...mari, isSelf: true },
          { ...mari, id: 'm4', name: 'Jaan' },
        ]}
      />,
    )
    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument()
    expect(screen.getByText('per serving')).toBeInTheDocument()
    expect(screen.getByText('38g')).toBeInTheDocument()
  })

  it('shows no chips without members', () => {
    renderInLocale(<PortionNutrition nutrition={trout} />)
    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument()
    expect(screen.getByText('per serving')).toBeInTheDocument()
  })

  it('formats the multiplier for Estonian', () => {
    renderInLocale(<PortionNutrition nutrition={trout} portions={[kaupo, mari, nora]} />, 'et')
    fireEvent.click(screen.getByRole('radio', { name: 'Kaupo 1,5×' }))
    expect(screen.getByText('Kaupo, 1,5× portsjon')).toBeInTheDocument()
  })
})
