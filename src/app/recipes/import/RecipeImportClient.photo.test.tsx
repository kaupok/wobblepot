import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
// Photo import (HON-1274). Its own file, so `RecipeImportClient.test.tsx`
// stays under the file-size cap. Copy is resolved against the real catalogs.
vi.unmock('next-intl')
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NextIntlClientProvider } from 'next-intl'
import enMessages from '../../../../messages/en.json'
import etMessages from '../../../../messages/et.json'
import { createQueryWrapper } from '@/test/query-wrapper'
import { RecipeImportClient } from './RecipeImportClient'

const push = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, refresh: vi.fn() }),
}))

function renderInLocale(locale: 'en' | 'et' = 'en') {
  const { wrapper: QueryWrapper } = createQueryWrapper()
  return render(
    <QueryWrapper>
      <NextIntlClientProvider locale={locale} messages={locale === 'en' ? enMessages : etMessages}>
        <RecipeImportClient />
      </NextIntlClientProvider>
    </QueryWrapper>,
  )
}

/** The hidden file input inside `AttachImages`; the visible trigger only clicks it. */
function fileInput() {
  return document.querySelector<HTMLInputElement>('input[type="file"]')!
}

const photo = (name = 'soup-card.jpg') => new File(['jpeg-bytes'], name, { type: 'image/jpeg' })

async function attach(...files: File[]) {
  await userEvent.upload(fileInput(), files, { applyAccept: false })
}

const RECIPE = {
  name: 'Grandma soup',
  description: null,
  preparationNotes: null,
  sourceUrl: null,
  timeMinutes: null,
  servings: 6,
  mealTypes: ['dinner'],
  kidFriendly: true,
  ingredients: [],
  allMatched: true,
}

function respondWith(body: Record<string, unknown>, status = 200) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: status < 400,
    status,
    json: () => Promise.resolve(body),
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

beforeEach(() => {
  sessionStorage.clear()
  push.mockClear()
  // jsdom has no blob URLs; the previews only need a string.
  URL.createObjectURL = vi.fn(() => 'blob:mock/preview')
  URL.revokeObjectURL = vi.fn()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('RecipeImportClient photos', () => {
  it('labels the attach control', () => {
    renderInLocale('en')
    expect(screen.getByRole('button', { name: 'Add a photo of a recipe' })).toBeInTheDocument()
  })

  it('enables Import recipe once a photo is attached with no text', async () => {
    renderInLocale()
    const submit = screen.getByRole('button', { name: 'Import recipe' })
    expect(submit).toBeDisabled()

    await attach(photo())

    expect(screen.getByRole('img', { name: 'soup-card.jpg' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remove soup-card.jpg' })).toBeInTheDocument()
    expect(submit).toBeEnabled()
  })

  it('accepts up to 3 photos, then disables the attach control', async () => {
    renderInLocale()
    await attach(photo('1.jpg'), photo('2.jpg'), photo('3.jpg'))

    expect(screen.getAllByRole('img')).toHaveLength(3)
    expect(screen.getByRole('button', { name: 'Add a photo of a recipe' })).toBeDisabled()
  })

  it('sends a photo with no text as FormData with one image and no text field', async () => {
    const fetchMock = respondWith({ success: true, confidenceTier: 'high', recipe: RECIPE })
    renderInLocale()
    await attach(photo())
    fireEvent.click(screen.getByRole('button', { name: 'Import recipe' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit]
    expect(url).toBe('/api/recipes/parse')
    expect(init.body).toBeInstanceOf(FormData)
    const body = init.body as FormData
    expect(body.getAll('image')).toHaveLength(1)
    expect((body.get('image') as File).name).toBe('soup-card.jpg')
    expect(body.has('text')).toBe(false)
    // The browser must set the multipart boundary itself.
    expect(new Headers(init.headers).get('content-type')).toBeNull()
  })

  it('sends typed text with the photos as the text field', async () => {
    const fetchMock = respondWith({ success: true, confidenceTier: 'high', recipe: RECIPE })
    renderInLocale()
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Serves 6' } })
    await attach(photo())
    fireEvent.click(screen.getByRole('button', { name: 'Import recipe' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const body = (fetchMock.mock.calls[0]![1] as RequestInit).body as FormData
    expect(body.get('text')).toBe('Serves 6')
  })

  it('opens the create form with the recipe, and stashes no text for a photo-only import', async () => {
    respondWith({ success: true, confidenceTier: 'high', recipe: RECIPE })
    renderInLocale()
    await attach(photo())
    fireEvent.click(screen.getByRole('button', { name: 'Import recipe' }))

    await waitFor(() => expect(push).toHaveBeenCalledWith('/recipes/create?prefilled=true'))
    const stash = JSON.parse(sessionStorage.getItem('prefilled-meal')!)
    expect(stash).toMatchObject({ name: 'Grandma soup', servings: 6, origin: 'import' })
    expect(stash).not.toHaveProperty('originalRecipeText')
  })

  it.each([
    ['en', 'We could not find a recipe in the photo.', 'Imagine a meal'],
    ['et', 'Fotolt ei leidnud retsepti.', 'Mõtle välja toit'],
  ] as const)(
    'renders photo_no_recipe with a link to Imagine a meal (%s)',
    async (locale, copy, linkName) => {
      vi.spyOn(console, 'error').mockImplementation(() => {})
      respondWith({ success: false, error: 'server prose', code: 'photo_no_recipe' }, 400)
      renderInLocale(locale)
      await attach(photo('dish.jpg'))
      fireEvent.click(
        screen.getByRole('button', { name: locale === 'en' ? 'Import recipe' : 'Impordi retsept' }),
      )

      expect(await screen.findByText(new RegExp(copy))).toBeInTheDocument()
      expect(screen.getByRole('link', { name: linkName })).toHaveAttribute(
        'href',
        '/recipes/imagine',
      )
      expect(screen.queryByText('server prose')).not.toBeInTheDocument()
    },
  )

  it('renders the image-count error with the limit filled in', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    respondWith({ success: false, error: 'Maximum 3 images allowed', code: 'too_many_images' }, 400)
    renderInLocale()
    await attach(photo())
    fireEvent.click(screen.getByRole('button', { name: 'Import recipe' }))

    expect(await screen.findByText('You can attach up to 3 images')).toBeInTheDocument()
  })

  it('shows the photo progress steps, starting with Reading the photo', async () => {
    renderInLocale()
    // A link in the text is not fetched with photos, so the link steps do not apply.
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'https://example.com/recipe' },
    })
    await attach(photo())
    vi.useFakeTimers()
    vi.stubGlobal('fetch', () => new Promise(() => {}))
    fireEvent.click(screen.getByRole('button', { name: 'Import recipe' }))

    expect(screen.getByText('Reading the photo…')).toBeInTheDocument()
    act(() => vi.advanceTimersByTime(5000 + 150))
    expect(screen.getByText('Extracting recipe…')).toBeInTheDocument()
    act(() => vi.advanceTimersByTime(7000 + 150))
    expect(screen.getByText('Matching ingredients…')).toBeInTheDocument()
  })
})
