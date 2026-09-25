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

  it('groups items into a Today and a Tomorrow list instead of tagging each row', () => {
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <UrgentShopping
          items={[item('Apple', 'tomorrow'), item('Zucchini', 'today'), item('Tomato', 'today')]}
        />
      </NextIntlClientProvider>,
    )

    const rowsOf = (list: HTMLElement) =>
      within(list)
        .getAllByRole('listitem')
        .map((li) => li.textContent)
    const lists = screen.getAllByRole('list')
    expect(lists).toHaveLength(2)
    expect(rowsOf(screen.getByRole('list', { name: 'Today' }))).toEqual([
      'Tomato1 pc',
      'Zucchini1 pc',
    ])
    expect(rowsOf(screen.getByRole('list', { name: 'Tomorrow' }))).toEqual(['Apple1 pc'])
    expect(lists.indexOf(screen.getByRole('list', { name: 'Today' }))).toBe(0)
    // The day is said once, as the list's label: no per-row due tag, and no
    // heading that would outrank the meal days' `h5`s in the page outline.
    expect(screen.getAllByText('Today')).toHaveLength(1)
    expect(screen.queryByRole('heading')).not.toBeInTheDocument()
  })

  it('shows only the label for the one day that has items', () => {
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <UrgentShopping items={[item('Apple', 'tomorrow')]} />
      </NextIntlClientProvider>,
    )

    expect(screen.getByRole('list', { name: 'Tomorrow' })).toBeInTheDocument()
    expect(screen.queryByText('Today')).not.toBeInTheDocument()
  })

  it('titles the panel "Shopping list" with neither a summary line nor an item count', () => {
    const { container } = render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <UrgentShopping items={items} />
      </NextIntlClientProvider>,
    )

    expect(screen.getByText('Shopping list')).toBeInTheDocument()
    expect(screen.queryByText(/^Need /)).not.toBeInTheDocument()
    expect(container.querySelector('.text-warning')).toBeNull()
    expect(screen.getByRole('link', { name: 'View full list' })).toHaveAttribute(
      'href',
      '/shopping',
    )
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

    // The phone form has no list, so the summary line is the whole message;
    // the item count that used to sit beside the title is gone from both forms.
    it('shows the summary and the link, but no item count', () => {
      const { container } = renderForm(fixture, true)

      expect(screen.getByText('Need 2 for today, 1 for tomorrow')).toBeInTheDocument()
      expect(screen.getByRole('link', { name: 'View full list' })).toHaveAttribute(
        'href',
        '/shopping',
      )
      expect(container.querySelector('.text-warning')).toBeNull()
    })

    it('leaves out the item list and the purchased section', () => {
      renderForm(fixture, true)

      expect(screen.getByText('Shopping list')).toBeInTheDocument()
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
