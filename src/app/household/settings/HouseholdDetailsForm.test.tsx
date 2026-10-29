import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NextIntlClientProvider } from 'next-intl'
import { renderToString } from 'react-dom/server'
import { toast } from 'sonner'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  defaultHousehold,
  fail,
  mockFetch,
  ok,
  OWNER_ONLY_NOTICE,
  renderSettings,
  section,
  stubPointerApis,
} from '@/test/household-settings'

import enMessages from '../../../../messages/en.json'
import etMessages from '../../../../messages/et.json'
import { HouseholdDetailsForm } from './HouseholdDetailsForm'

vi.unmock('next-intl')

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

const mockRouterRefresh = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    refresh: mockRouterRefresh,
  }),
}))

global.fetch = mockFetch

function renderForm(
  overrides: Partial<Parameters<typeof HouseholdDetailsForm>[0]> = {},
  locale: 'en' | 'et' = 'en',
) {
  return renderSettings(
    <HouseholdDetailsForm household={defaultHousehold} isOwner {...overrides} />,
    locale,
  )
}

/**
 * Household → Settings (HON-1257). The cases are the Household details half
 * of the old `HouseholdSettingsForm.test.tsx`; the food and meal cases are in
 * `../meal-preferences/`.
 */
describe('HouseholdDetailsForm', () => {
  beforeEach(() => {
    mockFetch.mockReset()
    mockRouterRefresh.mockReset()
    vi.mocked(toast.success).mockReset()
    vi.mocked(toast.error).mockReset()
    stubPointerApis()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('rendering', () => {
    // The weekly reminder is the viewer's own, on My account → Reminders (HON-1256).
    it('renders the Household details section, with no weekly reminder', () => {
      renderForm()

      const headings = screen.getAllByRole('heading').map((h) => h.textContent)
      expect(headings).toEqual(['Household details'])
      expect(screen.queryByRole('form', { name: 'Weekly reminder' })).not.toBeInTheDocument()
    })

    /**
     * The layout supplies the `<h1>` (`src/app/household/layout.tsx`); the
     * section is an `<h2>` under it, at the Section size, with nothing under
     * it (HON-960). axe's `heading-order` cannot see a section that lost its
     * `as` or kept a Caption-sized `<h3>`.
     */
    it('renders the section as an h2 at the Section size, with no h3', () => {
      renderForm()

      const heading = screen.getByRole('heading', { name: 'Household details', level: 2 })
      expect(heading).toHaveClass('text-base', 'font-semibold')
      expect(heading).not.toHaveClass('uppercase')
      expect(screen.queryAllByRole('heading', { level: 3 })).toHaveLength(0)
    })

    it('renders only the language helper line', () => {
      const { container } = renderForm()

      const helpers = Array.from(container.querySelectorAll('p.text-muted-foreground')).map(
        (p) => p.textContent,
      )
      expect(helpers).toEqual(['Recipes you already have keep their language.'])
    })

    it('renders household name input with initial value', () => {
      renderForm()

      expect(screen.getByLabelText('Household name')).toHaveValue('Test Household')
    })
  })

  describe('owner vs member permissions', () => {
    it('enables name and timezone inputs for owners', () => {
      renderForm({ isOwner: true })

      expect(screen.getByLabelText('Household name')).not.toBeDisabled()
      expect(screen.getByRole('combobox', { name: /timezone/i })).not.toBeDisabled()
    })

    it('disables name input for non-owners', () => {
      renderForm({ isOwner: false })

      expect(screen.getByLabelText('Household name')).toBeDisabled()
    })

    // The Settings page shows a member the notice once, above the form.
    it('leaves the owner-only message to the page for non-owners', () => {
      renderForm({ isOwner: false })

      expect(screen.queryByText(OWNER_ONLY_NOTICE)).not.toBeInTheDocument()
    })

    it('never shows a save button to non-owners', () => {
      renderForm({ isOwner: false })

      expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
    })
  })

  describe('form interactions', () => {
    it('updates name input on change', async () => {
      renderForm()

      const nameInput = screen.getByLabelText('Household name')
      await userEvent.clear(nameInput)
      await userEvent.type(nameInput, 'New Household Name')

      expect(nameInput).toHaveValue('New Household Name')
    })

    it('renders timezone select with current value', () => {
      renderForm()

      expect(screen.getByRole('combobox', { name: /timezone/i })).toHaveTextContent(
        'Europe/Tallinn',
      )
    })

    it('disables timezone select for non-owners', () => {
      renderForm({ isOwner: false })

      expect(screen.getByRole('combobox', { name: /timezone/i })).toBeDisabled()
    })
  })

  // Radix only mirrors a selected item's text into a childless SelectValue
  // after mount, so the server HTML used to carry empty triggers (HON-761).
  describe('server render', () => {
    it('includes the timezone and language values inside their triggers', () => {
      const html = renderToString(
        <NextIntlClientProvider locale="en" messages={enMessages}>
          <QueryClientProvider client={new QueryClient()}>
            <HouseholdDetailsForm household={defaultHousehold} isOwner />
          </QueryClientProvider>
        </NextIntlClientProvider>,
      )
      const doc = new DOMParser().parseFromString(html, 'text/html')

      expect(doc.getElementById('timezone')?.textContent).toContain('Europe/Tallinn')
      expect(doc.getElementById('locale')?.textContent).toContain('English')
    })
  })

  // The Save button shows only while the section differs from what was saved
  // (HON-961).
  describe('save button visibility', () => {
    it('shows no save button at rest', () => {
      renderForm()

      expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
    })

    it('shows the save button inside the section once the name changes', async () => {
      renderForm()

      await userEvent.type(screen.getByLabelText('Household name'), '!')

      expect(within(section('Household details')).getByRole('button', { name: 'Save' })).toBe(
        screen.getByRole('button', { name: 'Save' }),
      )
    })

    it('hides the button again when the change is undone', async () => {
      renderForm()

      const nameInput = screen.getByLabelText('Household name')
      await userEvent.type(nameInput, '!')
      await userEvent.type(nameInput, '{Backspace}')

      expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
    })

    it('does not send anything when a clean section is submitted', async () => {
      renderForm()

      // Enter in the name field submits its form even with no button shown.
      fireEvent.submit(section('Household details'))
      await new Promise((resolve) => setTimeout(resolve, 0))

      expect(mockFetch).not.toHaveBeenCalled()
    })
  })

  describe('household details', () => {
    it('saves the new timezone, and nothing else, to the household', async () => {
      mockFetch.mockResolvedValue(ok())
      renderForm()

      const timezoneTrigger = screen.getByRole('combobox', { name: /timezone/i })
      await userEvent.click(timezoneTrigger)
      await userEvent.click(screen.getByRole('option', { name: 'America/New York' }))
      expect(timezoneTrigger).toHaveTextContent('America/New York')

      await userEvent.click(screen.getByRole('button', { name: 'Save' }))

      await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Settings saved'))
      expect(mockFetch).toHaveBeenCalledTimes(1)
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/households/me',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({
            name: 'Test Household',
            timezone: 'America/New_York',
            locale: 'en',
          }),
        }),
      )
    })

    // The full timezone list mounts on the trigger's first focus (HON-1180),
    // so a keyboard user's typeahead on the closed trigger still finds every
    // timezone, not only the selected one.
    it('picks a timezone by typing on the closed trigger', async () => {
      const user = userEvent.setup()
      renderForm()

      const timezoneTrigger = screen.getByRole('combobox', { name: /timezone/i })
      await user.tab()
      await user.tab()
      expect(timezoneTrigger).toHaveFocus()
      await user.keyboard('a')

      expect(timezoneTrigger).toHaveTextContent('Africa/Abidjan')
      expect(timezoneTrigger).toHaveAttribute('aria-expanded', 'false')
    })

    it('saves the new locale', async () => {
      mockFetch.mockResolvedValue(ok())
      renderForm()

      const localeTrigger = screen.getByRole('combobox', { name: /language/i })
      expect(localeTrigger).toHaveTextContent('English')
      await userEvent.click(localeTrigger)
      await userEvent.click(screen.getByRole('option', { name: 'Estonian' }))
      expect(localeTrigger).toHaveTextContent('Estonian')

      await userEvent.click(screen.getByRole('button', { name: 'Save' }))

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith(
          '/api/households/me',
          expect.objectContaining({
            body: JSON.stringify({
              name: 'Test Household',
              timezone: 'Europe/Tallinn',
              locale: 'et',
            }),
          }),
        )
      })
    })

    it('invalidates the whole query cache before refreshing when the locale changes', async () => {
      mockFetch.mockResolvedValue(ok())
      const { queryClient } = renderForm()
      const invalidate = vi.spyOn(queryClient, 'invalidateQueries')

      await userEvent.click(screen.getByRole('combobox', { name: /language/i }))
      await userEvent.click(screen.getByRole('option', { name: 'Estonian' }))
      await userEvent.click(screen.getByRole('button', { name: 'Save' }))

      await waitFor(() => expect(mockRouterRefresh).toHaveBeenCalled())
      // No filter: every cached entity carries locale-dependent names.
      expect(invalidate).toHaveBeenCalledWith()
      expect(invalidate.mock.invocationCallOrder[0]).toBeLessThan(
        mockRouterRefresh.mock.invocationCallOrder[0]!,
      )
    })

    it('leaves the query cache alone when the locale is unchanged', async () => {
      mockFetch.mockResolvedValue(ok())
      const { queryClient } = renderForm()
      const invalidate = vi.spyOn(queryClient, 'invalidateQueries')

      await userEvent.type(screen.getByLabelText('Household name'), '!')
      await userEvent.click(screen.getByRole('button', { name: 'Save' }))

      await waitFor(() => expect(mockRouterRefresh).toHaveBeenCalled())
      expect(invalidate).not.toHaveBeenCalled()
    })
  })

  describe('after a save', () => {
    it('removes the button and moves focus to the section heading', async () => {
      mockFetch.mockResolvedValue(ok())
      renderForm()

      await userEvent.type(screen.getByLabelText('Household name'), '!')
      await userEvent.click(screen.getByRole('button', { name: 'Save' }))

      await waitFor(() =>
        expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument(),
      )
      expect(screen.getByRole('heading', { name: 'Household details' })).toHaveFocus()
    })
  })

  describe('after a failed save', () => {
    it('shows catalog copy under the section, not the route error', async () => {
      mockFetch.mockResolvedValue(fail(400, 'Validation failed'))
      renderForm()

      await userEvent.type(screen.getByLabelText('Household name'), '!')
      await userEvent.click(screen.getByRole('button', { name: 'Save' }))

      const details = section('Household details')
      await waitFor(() => {
        expect(within(details).getByRole('alert')).toHaveTextContent(
          enMessages.household.settings.saveFailed,
        )
      })
      expect(screen.queryByText('Validation failed')).not.toBeInTheDocument()
      expect(screen.getByLabelText('Household name')).toHaveAccessibleDescription(
        enMessages.household.settings.saveFailed,
      )
      expect(within(details).getByRole('button', { name: 'Save' })).toBeInTheDocument()
    })

    // With the button gone there is nothing to retry, so the error goes too.
    it('clears the error when the change is undone', async () => {
      mockFetch.mockResolvedValue(fail(500, 'Failed to update household'))
      renderForm()

      const nameInput = screen.getByLabelText('Household name')
      await userEvent.type(nameInput, '!')
      await userEvent.click(screen.getByRole('button', { name: 'Save' }))
      await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument())

      await userEvent.type(nameInput, '{Backspace}')

      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      expect(nameInput).not.toHaveAttribute('aria-invalid', 'true')
      expect(nameInput).not.toHaveAccessibleDescription()

      // A new edit is not the change that failed, so the error stays gone.
      await userEvent.type(nameInput, '?')
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      expect(nameInput).not.toHaveAttribute('aria-invalid', 'true')
    })

    // No button to press, so submit the form element directly: the section
    // itself must refuse, not just the missing button (HON-677).
    it('does not send any request when a non-owner submits', async () => {
      mockFetch.mockResolvedValue(ok())
      renderForm({ isOwner: false })

      fireEvent.submit(section('Household details'))
      await new Promise((resolve) => setTimeout(resolve, 0))

      expect(mockFetch).not.toHaveBeenCalled()
      expect(toast.success).not.toHaveBeenCalled()
      expect(mockRouterRefresh).not.toHaveBeenCalled()
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })

    // An Estonian household must never read the route's English `error`
    // (HON-914), so this renders the real `et` catalog.
    describe('in Estonian', () => {
      const et = etMessages.household.settings

      it('shows the Estonian save failure for a validation error', async () => {
        mockFetch.mockResolvedValue(fail(400, 'Validation failed'))
        renderForm({}, 'et')

        await userEvent.type(screen.getByLabelText(et.nameLabel), '!')
        await userEvent.click(screen.getByRole('button', { name: et.saveButton }))

        await waitFor(() => expect(screen.getByText(et.saveFailed)).toBeInTheDocument())
        expect(screen.queryByText('Validation failed')).not.toBeInTheDocument()
      })
    })
  })

  describe('locale selector', () => {
    it('exposes English and Estonian as selectable options', async () => {
      renderForm({ household: { ...defaultHousehold, locale: 'en' } })

      await userEvent.click(screen.getByRole('combobox', { name: /language/i }))

      const englishOption = await screen.findByRole('option', { name: 'English' })
      const estonianOption = await screen.findByRole('option', { name: 'Estonian' })

      expect(englishOption).not.toHaveAttribute('aria-disabled', 'true')
      expect(estonianOption).not.toHaveAttribute('aria-disabled', 'true')
    })

    it('reflects the household locale on the trigger', () => {
      renderForm({ household: { ...defaultHousehold, locale: 'et' } })

      expect(screen.getByRole('combobox', { name: /language/i })).toHaveTextContent('Estonian')
    })
  })
})
