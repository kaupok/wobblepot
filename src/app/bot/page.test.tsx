import { render, screen } from '@testing-library/react'
import { beforeEach, describe, it, expect, vi } from 'vitest'
import { createTranslator, type Messages } from 'next-intl'
import enMessages from '../../../messages/en.json'
import etMessages from '../../../messages/et.json'
import type { Locale } from '@/lib/i18n/locales'
import BotPage from './page'

const { localeRef } = vi.hoisted(() => ({ localeRef: { current: 'en' as Locale } }))

const CATALOGS: Record<Locale, Messages> = { en: enMessages, et: etMessages }

vi.mock('next-intl/server', () => ({
  getTranslations: vi.fn(async (namespace: string) =>
    createTranslator({
      locale: localeRef.current,
      messages: CATALOGS[localeRef.current],
      namespace: namespace as never,
    }),
  ),
}))

describe('BotPage', () => {
  beforeEach(() => {
    localeRef.current = 'en'
  })

  it('links the privacy contact address (HON-645)', async () => {
    render(await BotPage())
    // Literal on purpose: asserting against PRIVACY_EMAIL would pass whatever the constant became.
    expect(screen.getByRole('link', { name: 'privacy@wobblepot.com' })).toHaveAttribute(
      'href',
      'mailto:privacy@wobblepot.com',
    )
  })

  it('shows the bot user-agent and robots token (HON-670)', async () => {
    render(await BotPage())
    // Literals on purpose: asserting against the bot-identity constants would pass whatever they became.
    expect(screen.getByText('Wobblepot-Bot/1.0 (+https://wobblepot.com/bot)')).toBeInTheDocument()
    expect(screen.getAllByText('Wobblepot-Bot/1.0', { selector: 'code' })).toHaveLength(3)
  })

  it('renders Estonian copy for an et request, keeping the token and contact link (HON-919)', async () => {
    localeRef.current = 'et'
    render(await BotPage())

    expect(
      screen.getByRole('heading', { level: 1, name: 'Wobblepot-Boti kohta' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'Mida see ei tee' })).toBeInTheDocument()
    expect(screen.getAllByText('Wobblepot-Bot/1.0', { selector: 'code' })).toHaveLength(3)
    expect(screen.getByRole('link', { name: 'privacy@wobblepot.com' })).toBeInTheDocument()
    expect(screen.queryByText(/What it does/)).not.toBeInTheDocument()
  })
})
