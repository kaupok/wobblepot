import { describe, it, expect, vi, afterEach } from 'vitest'
// `useLocale()` requires the real next-intl context; the global mock only
// stubs `useTranslations`.
vi.unmock('next-intl')
import { act } from 'react'
import { hydrateRoot } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { render, screen } from '@testing-library/react'
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
