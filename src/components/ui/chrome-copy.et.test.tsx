import { describe, it, expect, vi } from 'vitest'
import type { ReactNode } from 'react'

// Fixed chrome copy (Close, Loading, Cancel) comes from `common.*` inside the
// primitives (HON-914). The global next-intl mock resolves against English
// only, so this renders the real `et` catalog.
vi.unmock('next-intl')
import { render, screen, within } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import etMessages from '../../../messages/et.json'
import { TagInput } from '@/components/tag-input'
import { ConfirmDialog } from './confirm-dialog'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './dialog'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from './sheet'
import { Skeleton } from './skeleton'

const common = etMessages.common

function renderInEstonian(node: ReactNode) {
  return render(
    <NextIntlClientProvider locale="et" messages={etMessages}>
      {node}
    </NextIntlClientProvider>,
  )
}

describe('primitive chrome copy in Estonian', () => {
  it('Skeleton announces the Estonian loading label', () => {
    renderInEstonian(<Skeleton className="h-4 w-24" />)

    expect(screen.getByRole('status')).toHaveAccessibleName(common.loading)
  })

  it('Dialog names its close button in Estonian', () => {
    renderInEstonian(
      <Dialog open>
        <DialogContent>
          <DialogTitle>Pealkiri</DialogTitle>
          <DialogDescription>Kirjeldus</DialogDescription>
        </DialogContent>
      </Dialog>,
    )

    expect(
      within(screen.getByRole('dialog')).getByRole('button', { name: common.close }),
    ).toBeInTheDocument()
  })

  it('Sheet names its close button in Estonian', () => {
    renderInEstonian(
      <Sheet open>
        <SheetContent>
          <SheetTitle>Menüü</SheetTitle>
          <SheetDescription>Kirjeldus</SheetDescription>
        </SheetContent>
      </Sheet>,
    )

    expect(
      within(screen.getByRole('dialog')).getByRole('button', { name: common.close }),
    ).toBeInTheDocument()
  })

  it('ConfirmDialog defaults its cancel and confirm labels to Estonian', () => {
    renderInEstonian(
      <ConfirmDialog
        open
        onOpenChange={vi.fn()}
        title="Eemalda"
        description="Kas oled kindel?"
        onConfirm={vi.fn()}
      />,
    )

    const dialog = screen.getByRole('alertdialog')
    expect(within(dialog).getByRole('button', { name: common.cancel })).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: common.confirm })).toBeInTheDocument()
  })

  it('ConfirmDialog defaults its loading label to Estonian', () => {
    renderInEstonian(
      <ConfirmDialog
        open
        onOpenChange={vi.fn()}
        title="Eemalda"
        description="Kas oled kindel?"
        confirmLabel="Eemalda"
        onConfirm={vi.fn()}
        isLoading
      />,
    )

    expect(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: common.loading }),
    ).toBeInTheDocument()
  })

  it('TagInput names each remove button in Estonian', () => {
    renderInEstonian(<TagInput value={['gluteen']} onChange={vi.fn()} />)

    expect(
      screen.getByRole('button', { name: common.removeNamed.replace('{name}', 'gluteen') }),
    ).toBeInTheDocument()
  })
})
