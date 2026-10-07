import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
vi.unmock('next-intl')
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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

function props(searchParams: { ref?: string | string[] } = {}) {
  return { searchParams: Promise.resolve(searchParams) }
}

async function renderPage(searchParams: { ref?: string | string[] } = {}) {
  const page = await RequestInvitePage(props(searchParams))
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

    await expect(RequestInvitePage(props())).rejects.toThrow('NEXT_REDIRECT:/sign-up')
  })

  describe('the ref of the link the visitor followed (HON-1089)', () => {
    const fetchMock = vi.fn()

    beforeEach(() => {
      fetchMock.mockReset()
      fetchMock.mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      vi.stubGlobal('fetch', fetchMock)
    })

    afterEach(() => {
      vi.unstubAllGlobals()
    })

    async function submittedBody(searchParams: { ref?: string | string[] }) {
      const user = userEvent.setup({ delay: null })
      await renderPage(searchParams)
      await user.type(screen.getByLabelText('Email'), 'me@example.com')
      await user.click(screen.getByRole('button', { name: 'Ask for an invite' }))
      await screen.findByRole('status')
      expect(fetchMock).toHaveBeenCalledTimes(1)
      return JSON.parse(fetchMock.mock.calls[0]![1].body)
    }

    it('sends ?ref=mealime with the request, with no new text on the form', async () => {
      expect(await submittedBody({ ref: 'mealime' })).toEqual({
        email: 'me@example.com',
        locale: 'en',
        ref: 'mealime',
      })
      expect(screen.queryByText(/mealime/)).not.toBeInTheDocument()
    })

    it('sends no ref without one', async () => {
      expect(await submittedBody({})).toEqual({ email: 'me@example.com', locale: 'en' })
    })

    it('drops a repeated ref rather than picking one', async () => {
      expect(await submittedBody({ ref: ['mealime', 'reddit'] })).toEqual({
        email: 'me@example.com',
        locale: 'en',
      })
    })
  })

  it('titles the page in the request locale', async () => {
    expect(await generateMetadata()).toEqual({ title: 'Ask for an invite' })
    translationLocale = 'et'
    expect(await generateMetadata()).toEqual({ title: 'Küsi kutset' })
  })
})
