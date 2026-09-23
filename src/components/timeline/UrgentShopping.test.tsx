import { describe, it, expect, vi, afterEach } from 'vitest'
// `useLocale()` requires the real next-intl context; the global mock only
// stubs `useTranslations`.
vi.unmock('next-intl')
import { act } from 'react'
import { hydrateRoot } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { render, screen, within } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import enMessages from '../../../messages/en.json'
import { UrgentShopping } from './UrgentShopping'
import type { UrgencyBucket } from '@/lib/meal-planning/dates'

function item(name: string, urgency: UrgencyBucket = 'today') {
  return {
    ingredientId: name.toLowerCase(),
    name,
    displayQuantity: '1 pc',
    neededByDate: '2026-09-22',
    neededByRelative: urgency === 'today' ? 'Today' : 'Tomorrow',
    purchased: false,
    urgency,
  }
}

// Estonian collation sorts `z` between `s` and `t`, so these two come out in
// opposite orders under an `en` and an `et` runtime default.
const items = [item('Zucchini'), item('Tomato'), item('Apple')]

function tree() {
  return (
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <UrgentShopping items={items} />
    </NextIntlClientProvider>
  )
}

/**
 * Make `localeCompare` without an explicit locale resolve `et`, the way it does
 * in a browser whose language is Estonian, while the page itself renders `en`.
 */
function simulateEstonianRuntimeDefault() {
  const original = String.prototype.localeCompare
  vi.spyOn(String.prototype, 'localeCompare').mockImplementation(function (
    this: string,
    that: string,
    locales?: Intl.LocalesArgument,
    options?: Intl.CollatorOptions,
  ) {
    return original.call(this, that, locales ?? 'et', options)
  })
}

function renderedNames(container: HTMLElement) {
  return Array.from(container.querySelectorAll('li > span:first-child')).map((el) => el.textContent)
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('UrgentShopping', () => {
  it('sorts by the app locale, not the runtime default locale', () => {
    simulateEstonianRuntimeDefault()
    const { container } = render(tree())

    expect(renderedNames(container)).toEqual(['Apple', 'Tomato', 'Zucchini'])
  })

  it('puts today items before tomorrow items', () => {
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <UrgentShopping items={[item('Apple', 'tomorrow'), item('Zucchini', 'today')]} />
      </NextIntlClientProvider>,
    )

    const names = screen.getAllByRole('listitem').map((li) => li.firstElementChild?.textContent)
    expect(names).toEqual(['Zucchini', 'Apple'])
  })

  // HON-762: needing something today is urgency, not failure (DESIGN.md → Color).
  it('marks today with the warning token and leaves tomorrow muted', () => {
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <UrgentShopping items={[item('Apple', 'tomorrow'), item('Zucchini', 'today')]} />
      </NextIntlClientProvider>,
    )

    const today = screen.getByText('Today')
    expect(today).toHaveClass('text-warning')
    expect(today).not.toHaveClass('text-destructive')
    expect(screen.getByText('Tomorrow')).toHaveClass('text-muted-foreground')
  })

  describe('compact (HON-766)', () => {
    const fixture = [
      item('Apple', 'tomorrow'),
      item('Zucchini', 'today'),
      item('Tomato', 'today'),
      { ...item('Onion', 'today'), purchased: true },
    ]

    function renderForm(items: ReturnType<typeof item>[], compact: boolean) {
      return render(
        <NextIntlClientProvider locale="en" messages={enMessages}>
          <UrgentShopping items={items} compact={compact} />
        </NextIntlClientProvider>,
      )
    }

    function summaryOf(container: HTMLElement) {
      const view = within(container)
      return {
        count: container.querySelector('.text-warning')?.textContent,
        summary: view.getByText(/^Need /).textContent,
        link: view.getByRole('link', { name: 'View full list' }).getAttribute('href'),
      }
    }

    it('shows the same count, summary and link as the full panel', () => {
      const full = renderForm(fixture, false)
      const expected = summaryOf(full.container)
      full.unmount()

      const { container } = renderForm(fixture, true)
      expect(summaryOf(container)).toEqual(expected)
      expect(expected).toEqual({
        count: '3',
        summary: 'Need 2 for today, 1 for tomorrow',
        link: '/shopping',
      })
    })

    it('leaves out the item list and the purchased section', () => {
      renderForm(fixture, true)

      expect(screen.getByText('Shopping')).toBeInTheDocument()
      expect(screen.queryByRole('list')).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /purchased/i })).not.toBeInTheDocument()
    })

    it('renders nothing when there is nothing to buy', () => {
      expect(renderForm([], true).container).toBeEmptyDOMElement()
    })

    it('renders nothing when every urgent item is purchased', () => {
      const { container } = renderForm([{ ...item('Onion'), purchased: true }], true)
      expect(container).toBeEmptyDOMElement()
    })
  })

  // HON-751: the server (Vercel, `en-US`) and an Estonian browser sorted the
  // list differently, so hydration failed with React error 418.
  it('hydrates without a mismatch when the browser default locale differs from the server', async () => {
    const html = renderToString(tree())

    simulateEstonianRuntimeDefault()
    const container = document.createElement('div')
    container.innerHTML = html
    document.body.appendChild(container)
    const onRecoverableError = vi.fn()

    await act(async () => {
      hydrateRoot(container, tree(), { onRecoverableError })
    })

    expect(onRecoverableError).not.toHaveBeenCalled()
    expect(renderedNames(container)).toEqual(['Apple', 'Tomato', 'Zucchini'])
    container.remove()
  })
})
