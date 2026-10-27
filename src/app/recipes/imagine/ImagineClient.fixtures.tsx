import { fireEvent, render, screen } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import type { ReactNode } from 'react'
import enMessages from '../../../../messages/en.json'
import etMessages from '../../../../messages/et.json'
import { createQueryWrapper } from '@/test/query-wrapper'
import { ImagineClient } from './ImagineClient'

// A test file that uses these calls `vi.unmock('next-intl')` first: the copy
// is resolved against the real catalog in a real locale.
export function renderInLocale(node: ReactNode, locale: 'en' | 'et') {
  const messages = locale === 'en' ? enMessages : etMessages
  const { wrapper: QueryWrapper } = createQueryWrapper()
  return render(
    <QueryWrapper>
      <NextIntlClientProvider locale={locale} messages={messages}>
        {node}
      </NextIntlClientProvider>
    </QueryWrapper>,
  )
}

/** Renders the page, types a prompt and presses "Imagine meals". */
export async function generate(locale: 'en' | 'et') {
  renderInLocale(<ImagineClient />, locale)
  const textarea = screen.getByRole('textbox')
  fireEvent.change(textarea, { target: { value: 'something with lentils' } })
  const label = locale === 'en' ? /imagine meals/i : /mõtle toidud välja/i
  fireEvent.click(screen.getByRole('button', { name: label }))
}
