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
import etMessages from '../../../messages/et.json'
import { getLaterItemsSummary, UrgentShopping } from './UrgentShopping'
import type { UrgencyBucket } from '@/lib/meal-planning/dates'

const TODAY = '2026-09-22'

function item(name: string, urgency: UrgencyBucket = 'today', neededByDate = TODAY) {
  return {
    ingredientId: name.toLowerCase(),
    name,
    displayQuantity: '1 pc',
    neededByDate,
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
      <UrgentShopping items={items} todayDate={TODAY} />
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
        <UrgentShopping
          items={[item('Apple', 'tomorrow'), item('Zucchini', 'today')]}
          todayDate={TODAY}
        />
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
          todayDate={TODAY}
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
    // heading that would land among the meal days' `h2`s in the page outline.
    expect(screen.getAllByText('Today')).toHaveLength(1)
    expect(screen.queryByRole('heading')).not.toBeInTheDocument()
  })

  it('shows only the label for the one day that has items', () => {
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <UrgentShopping items={[item('Apple', 'tomorrow')]} todayDate={TODAY} />
      </NextIntlClientProvider>,
    )

    expect(screen.getByRole('list', { name: 'Tomorrow' })).toBeInTheDocument()
    expect(screen.queryByText('Today')).not.toBeInTheDocument()
  })

  it('titles the panel "Shopping list" with neither a summary line nor an item count', () => {
    const { container } = render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <UrgentShopping items={items} todayDate={TODAY} />
      </NextIntlClientProvider>,
    )

    expect(screen.getByText('Shopping list')).toBeInTheDocument()
    expect(screen.queryByText(/^Need /)).not.toBeInTheDocument()
    expect(container.querySelector('.text-warning')).toBeNull()
  })

  // HON-923: the branch is reached by an empty plan as often as by a stocked
  // pantry, so it states a fact rather than claiming the household is ready.
  describe('nothing to buy for today or tomorrow', () => {
    it.each([
      ['no items at all', []],
      ['every urgent item purchased', [{ ...item('Onion'), purchased: true }]],
    ])('shows the neutral empty line and no icon: %s', (_, input) => {
      const { container } = render(
        <NextIntlClientProvider locale="en" messages={enMessages}>
          <UrgentShopping items={input} todayDate={TODAY} />
        </NextIntlClientProvider>,
      )

      expect(screen.getByText('Shopping list')).toBeInTheDocument()
      expect(screen.getByText('Nothing on the list for today or tomorrow')).toBeInTheDocument()
      expect(screen.queryByText(/all set/i)).not.toBeInTheDocument()
      expect(container.querySelector('svg')).toBeNull()
    })
  })

  // HON-928: what lies past tomorrow, counted against the household's today.
  describe('getLaterItemsSummary', () => {
    it('counts the unpurchased items due after tomorrow', () => {
      expect(
        getLaterItemsSummary(
          [
            item('Apple', 'today'),
            item('Bread', 'tomorrow', '2026-09-23'),
            item('Rice', 'this-week', '2026-09-24'),
            item('Beans', 'later', '2026-09-26'),
          ],
          TODAY,
        ).count,
      ).toBe(2)
    })

    it('runs the days through the latest needed date, inclusive', () => {
      const summary = getLaterItemsSummary(
        [item('Rice', 'this-week', '2026-09-26'), item('Beans', 'this-week', '2026-09-24')],
        TODAY,
      )
      expect(summary.days).toBe(5)
    })

    it('never counts more than the 7-day window', () => {
      expect(getLaterItemsSummary([item('Rice', 'later', '2026-10-05')], TODAY).days).toBe(7)
    })

    it('leaves purchased items out of both the count and the days', () => {
      const summary = getLaterItemsSummary(
        [
          item('Rice', 'this-week', '2026-09-24'),
          { ...item('Beans', 'later', '2026-09-28'), purchased: true },
        ],
        TODAY,
      )
      expect(summary).toEqual({ count: 1, days: 3 })
    })

    it('counts from the household today, not the runtime clock', () => {
      // A household in UTC+3 at 01:00 on the 23rd, while the server is still
      // on the 22nd: the household's today is what the days count from.
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(new Date('2026-09-22T22:00:00Z'))
      try {
        expect(
          getLaterItemsSummary([item('Rice', 'this-week', '2026-09-27')], '2026-09-23').days,
        ).toBe(5)
      } finally {
        vi.useRealTimers()
      }
    })

    it('counts at least one day when every item is overdue', () => {
      expect(getLaterItemsSummary([item('Apple', 'today', '2026-09-20')], TODAY).days).toBe(1)
    })
  })

  describe('continuation row (HON-928)', () => {
    const later = Array.from({ length: 8 }, (_, i) =>
      item(`Later ${i}`, 'this-week', i < 7 ? '2026-09-24' : '2026-09-26'),
    )
    const urgent = [item('Apple'), item('Bread'), item('Milk', 'tomorrow', '2026-09-23')]

    function renderPanel(input: ReturnType<typeof item>[], locale: 'en' | 'et' = 'en') {
      return render(
        <NextIntlClientProvider
          locale={locale}
          messages={locale === 'en' ? enMessages : etMessages}
        >
          <UrgentShopping items={input} todayDate={TODAY} />
        </NextIntlClientProvider>,
      )
    }

    it('ends the listed items with "Plus 8 more for the next 5 days", linking to the list', () => {
      renderPanel([...urgent, ...later])

      expect(screen.getAllByRole('listitem')).toHaveLength(3)
      const links = screen.getAllByRole('link')
      expect(links).toHaveLength(1)
      expect(links[0]).toHaveAccessibleName('Plus 8 more for the next 5 days')
      expect(links[0]).toHaveAttribute('href', '/shopping')
    })

    // HON-947: the list's last line, not a card action, so no chevron.
    it('is a text link with no icon', () => {
      renderPanel([...urgent, ...later])

      expect(screen.getByRole('link').querySelector('svg')).toBeNull()
    })

    it('says it in Estonian for an Estonian household', () => {
      renderPanel([...urgent, ...later], 'et')

      expect(screen.getByRole('link')).toHaveAccessibleName('Ja veel 8 järgmise 5 päeva jaoks')
    })

    it('puts the row after the purchased collapse', () => {
      renderPanel([...urgent, { ...item('Onion'), purchased: true }, ...later])

      const toggle = screen.getByRole('button', { name: /1 item purchased/ })
      expect(
        toggle.compareDocumentPosition(screen.getByRole('link')) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy()
    })

    it('reads "8 items to buy over the next 5 days" under the empty line', () => {
      renderPanel(later)

      expect(screen.getByText('Nothing on the list for today or tomorrow')).toBeInTheDocument()
      expect(screen.getByRole('link')).toHaveAccessibleName('8 items to buy over the next 5 days')
    })

    it('reads "View full list" when nothing is due after tomorrow', () => {
      renderPanel(urgent)

      expect(screen.getByRole('link')).toHaveAccessibleName('View full list')
    })

    it('still links to the list when only custom items are open', () => {
      render(
        <NextIntlClientProvider locale="en" messages={enMessages}>
          <UrgentShopping items={[]} todayDate={TODAY} openCustomItemCount={2} />
        </NextIntlClientProvider>,
      )

      expect(screen.getByText('Nothing on the list for today or tomorrow')).toBeInTheDocument()
      expect(screen.getByRole('link')).toHaveAccessibleName('View full list')
    })

    it('has no row and no link when nothing is on the list', () => {
      renderPanel([])

      expect(screen.queryByRole('link')).not.toBeInTheDocument()
    })

    it('keeps the link off the title row', () => {
      renderPanel(urgent)

      const title = screen.getByText('Shopping list')
      expect(title.parentElement?.querySelector('a')).toBeNull()
    })
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
          <UrgentShopping items={items} todayDate={TODAY} compact={compact} />
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
