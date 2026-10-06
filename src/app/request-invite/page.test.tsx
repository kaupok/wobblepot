import { describe, it, expect, vi, beforeEach } from 'vitest'
vi.unmock('next-intl')
import { render, screen } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import enMessages from '../../../messages/en.json'
import etMessages from '../../../messages/et.json'
import RequestInvitePage, { generateMetadata } from './page'
import { getServerFlag } from '@/lib/feature-flags'
import { createQueryWrapper } from '@/test/query-wrapper'

let translationLocale: 'en' | 'et' = 'en'
const catalog = () => (translationLocale === 'et' ? etMessages : enMessages)

vi.mock('next-intl/server', async () => {
  const { createTranslator } = await vi.importActual<typeof import('next-intl')>('next-intl')
  return {
    getTranslations: vi.fn(async (namespace: string) =>
      createTranslator({
        locale: translationLocale,
        messages: catalog() as never,
        namespace: namespace as never,
      }),
    ),
  }
})

vi.mock('@/lib/feature-flags', () => ({
  getServerFlag: vi.fn(async () => true),
}))

vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`)
  }),
}))

async function renderPage() {
  const page = await RequestInvitePage()
  const { wrapper: Wrapper } = createQueryWrapper()
  return render(
    <NextIntlClientProvider locale={translationLocale} messages={catalog()}>
      <Wrapper>{page}</Wrapper>
    </NextIntlClientProvider>,
  )
}

describe('/request-invite', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    translationLocale = 'en'
    vi.mocked(getServerFlag).mockResolvedValue(true)
  })

  it('renders the form while invites are required', async () => {
    await renderPage()

    expect(getServerFlag).toHaveBeenCalledWith('invite_code_required', 'anonymous')
    expect(screen.getByRole('heading', { level: 1, name: 'Ask for an invite' })).toBeInTheDocument()
    expect(screen.getByLabelText('Email')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ask for an invite' })).toBeInTheDocument()
  })

  it('renders in Estonian', async () => {
    translationLocale = 'et'

    await renderPage()

    expect(screen.getByRole('heading', { level: 1, name: 'Küsi kutset' })).toBeInTheDocument()
    expect(
      screen.getByText('Liitud kellegi leibkonnaga? Kasuta linki, mille ta sulle saatis.'),
    ).toBeInTheDocument()
  })

  it('redirects to sign-up when sign-up is open', async () => {
    vi.mocked(getServerFlag).mockResolvedValue(false)

    await expect(RequestInvitePage()).rejects.toThrow('NEXT_REDIRECT:/sign-up')
  })

  it('titles the page in the request locale', async () => {
    expect(await generateMetadata()).toEqual({ title: 'Ask for an invite' })
    translationLocale = 'et'
    expect(await generateMetadata()).toEqual({ title: 'Küsi kutset' })
  })
})
