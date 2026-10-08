import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { OnboardingFlow } from './OnboardingFlow'
import { createQueryWrapper } from '@/test/query-wrapper'
import { dropFocusToBody } from '@/test/focus'

// Mock next/navigation
const mockPush = vi.fn()
const mockRefresh = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
    refresh: mockRefresh,
  }),
}))
vi.mock('@/lib/analytics', () => ({ track: vi.fn() }))

// Mock fetch globally
const mockFetch = vi.fn()
global.fetch = mockFetch

// jsdom does not implement scrolling; a step change scrolls the page to its top.
const mockScrollTo = vi.fn()
window.scrollTo = mockScrollTo as unknown as typeof window.scrollTo

function renderFlow(userName = 'John') {
  const { wrapper } = createQueryWrapper()
  return render(<OnboardingFlow userName={userName} />, { wrapper })
}

function respondOk(body: unknown) {
  return { ok: true, json: () => Promise.resolve(body) }
}

function householdRequestBody() {
  const call = mockFetch.mock.calls.find(([url]) => url === '/api/households')
  return JSON.parse(call![1].body as string)
}

describe('OnboardingFlow', () => {
  beforeEach(() => {
    mockFetch.mockReset()
    mockPush.mockReset()
    mockRefresh.mockReset()
    mockScrollTo.mockReset()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('Step 1: welcome and household name', () => {
    it('welcomes the user by name and counts four steps', () => {
      renderFlow()

      expect(screen.getByText('Step 1 of 4')).toBeInTheDocument()
      expect(
        screen.getByRole('heading', { level: 1, name: 'Welcome to Wobblepot, John!' }),
      ).toBeInTheDocument()
      expect(
        screen.getByText('Four quick steps, and your first meals are planned.'),
      ).toBeInTheDocument()
    })

    it('renders name input with default value based on userName', () => {
      renderFlow()

      expect(screen.getByLabelText('Household name')).toHaveValue("John's household")
    })

    // The input's id is `name`, so without this a browser offers the person's own name.
    it('turns off autofill on the household name input', () => {
      renderFlow()

      const nameInput = screen.getByLabelText('Household name')
      expect(nameInput).toHaveAttribute('name', 'householdName')
      expect(nameInput).toHaveAttribute('autocomplete', 'off')
    })

    it('renders Continue and no Back', () => {
      renderFlow()

      expect(screen.getByRole('button', { name: 'Continue' })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Back' })).not.toBeInTheDocument()
    })

    it('shows error when trying to continue with empty name', async () => {
      renderFlow()

      await userEvent.clear(screen.getByLabelText('Household name'))
      await userEvent.click(screen.getByRole('button', { name: 'Continue' }))

      expect(screen.getByRole('alert')).toHaveTextContent('Household name is required')
      expect(screen.getByText('Step 1 of 4')).toBeInTheDocument()
    })
  })

  describe('Focus management', () => {
    it('focuses the household name input on first render', () => {
      renderFlow()

      expect(screen.getByLabelText('Household name')).toHaveFocus()
    })

    it('focuses the step 2 title, described by the step number, after Continue', async () => {
      renderFlow()

      await userEvent.click(screen.getByRole('button', { name: 'Continue' }))

      const title = screen.getByRole('heading', { level: 1, name: "Who's at your table?" })
      expect(title).toHaveFocus()
      expect(title).toHaveAccessibleDescription('Step 2 of 4')
      expect(mockScrollTo).toHaveBeenCalledWith({ top: 0 })
    })

    it('focuses the step 1 title, described by the step number, after Back', async () => {
      renderFlow()

      await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
      await userEvent.click(screen.getByRole('button', { name: 'Back' }))

      const title = screen.getByRole('heading', { level: 1, name: 'Welcome to Wobblepot, John!' })
      expect(title).toHaveFocus()
      expect(title).toHaveAccessibleDescription('Step 1 of 4')
    })
  })

  describe('Step 2: who is at the table', () => {
    async function goToStep2() {
      renderFlow()
      await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
    }

    it('lists the user as the first adult, as text rather than a field', async () => {
      await goToStep2()

      const adults = screen.getByRole('region', { name: 'Adults' })
      expect(within(adults).getByText('John (you)')).toBeInTheDocument()
      expect(within(adults).queryByRole('textbox')).not.toBeInTheDocument()
      expect(
        within(screen.getByRole('region', { name: 'Children' })).queryByRole('list'),
      ).not.toBeInTheDocument()
    })

    it('adds a named row to the matching group, numbered within it', async () => {
      await goToStep2()

      await userEvent.click(screen.getByRole('button', { name: 'Add adult' }))
      await userEvent.click(screen.getByRole('button', { name: 'Add child' }))
      await userEvent.click(screen.getByRole('button', { name: 'Add child' }))

      const adults = screen.getByRole('region', { name: 'Adults' })
      const children = screen.getByRole('region', { name: 'Children' })
      // The user is adult 1, so the next adult is 2.
      expect(within(adults).getByLabelText('Adult 2 name')).toHaveAttribute(
        'placeholder',
        'Adult 2',
      )
      expect(within(children).getByLabelText('Child 1 name')).toBeInTheDocument()
      expect(within(children).getByLabelText('Child 2 name')).toBeInTheDocument()
    })

    it('keeps the Add button where it was, so repeated taps land on it', async () => {
      await goToStep2()

      const addChild = screen.getByRole('button', { name: 'Add child' })
      await userEvent.click(addChild)
      // The row goes after the button, inside the group, not before it.
      const row = screen.getByLabelText('Child 1 name')
      expect(addChild.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    })

    it('removes a row, keeps the typed names of the others, and focuses the Add button', async () => {
      await goToStep2()

      await userEvent.click(screen.getByRole('button', { name: 'Add child' }))
      await userEvent.click(screen.getByRole('button', { name: 'Add child' }))
      await userEvent.type(screen.getByLabelText('Child 1 name'), 'Emma')
      await userEvent.type(screen.getByLabelText('Child 2 name'), 'Leo')

      await userEvent.click(screen.getByRole('button', { name: 'Remove Emma' }))

      // Leo moves up and is numbered 1 now, with his name kept.
      expect(screen.getByLabelText('Child 1 name')).toHaveValue('Leo')
      expect(screen.queryByLabelText('Child 2 name')).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Add child' })).toHaveFocus()
    })

    it('names an unnamed row by its default in the Remove label', async () => {
      await goToStep2()

      await userEvent.click(screen.getByRole('button', { name: 'Add adult' }))

      expect(screen.getByRole('button', { name: 'Remove Adult 2' })).toBeInTheDocument()
    })

    it('stops adding at 10 people without moving focus off the Add button', async () => {
      await goToStep2()

      const addChild = screen.getByRole('button', { name: 'Add child' })
      for (let i = 0; i < 10; i++) await userEvent.click(addChild)

      // The user plus nine.
      expect(screen.getAllByRole('textbox')).toHaveLength(9)
      expect(addChild).toHaveAttribute('aria-disabled', 'true')
      expect(addChild).toHaveFocus()
      expect(screen.getByRole('button', { name: 'Add adult' })).toHaveAttribute(
        'aria-disabled',
        'true',
      )
      expect(screen.getByText(/10 people is the most for now/)).toBeInTheDocument()
    })
  })

  describe('Creating the household', () => {
    beforeEach(() => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    async function goToStep2() {
      await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
      // Wait for the transition guard to clear (500 ms, TRANSITION_GUARD_MS)
      await vi.advanceTimersByTimeAsync(600)
    }

    async function continueToStep3() {
      await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
      await vi.advanceTimersByTimeAsync(600)
    }

    async function goToStep3() {
      await goToStep2()
      await continueToStep3()
    }

    it('sends the name and the members, adults first, with default names for empty rows', async () => {
      mockFetch.mockResolvedValue(respondOk({ id: 'household-123' }))

      renderFlow()
      const nameInput = screen.getByLabelText('Household name')
      await userEvent.clear(nameInput)
      await userEvent.type(nameInput, 'My Household')
      await goToStep2()

      await userEvent.click(screen.getByRole('button', { name: 'Add child' }))
      await userEvent.type(screen.getByLabelText('Child 1 name'), ' Emma ')
      await userEvent.click(screen.getByRole('button', { name: 'Add adult' }))
      await userEvent.click(screen.getByRole('button', { name: 'Add child' }))
      await continueToStep3()
      await userEvent.click(screen.getByRole('button', { name: 'Continue' }))

      await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1))
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/households',
        expect.objectContaining({ method: 'POST' }),
      )
      expect(householdRequestBody()).toEqual({
        name: 'My Household',
        members: [
          { name: 'Adult 2', portionType: 'adult' },
          { name: 'Emma', portionType: 'child' },
          { name: 'Child 2', portionType: 'child' },
        ],
        allergensToAvoid: [],
      })
    })

    it('sends no members when the user is alone', async () => {
      mockFetch.mockResolvedValue(respondOk({ id: 'household-123' }))

      renderFlow()
      await goToStep3()
      await userEvent.click(screen.getByRole('button', { name: 'Continue' }))

      await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1))
      expect(householdRequestBody()).toEqual({
        name: "John's household",
        members: [],
        allergensToAvoid: [],
      })
    })

    it('moves to the first plan without leaving the page', async () => {
      mockFetch.mockResolvedValue(respondOk({ id: 'household-123' }))

      renderFlow()
      await goToStep3()
      await userEvent.click(screen.getByRole('button', { name: 'Continue' }))

      const title = await screen.findByRole('heading', { level: 1, name: 'Plan your first meals' })
      expect(title).toHaveFocus()
      expect(title).toHaveAccessibleDescription('Step 4 of 4')
      // The household exists now, so there is no step to go back to.
      expect(screen.queryByRole('button', { name: 'Back' })).not.toBeInTheDocument()
      expect(screen.getByRole('radiogroup', { name: 'Start from' })).toBeInTheDocument()
      expect(
        screen.getByText(
          'We start with dinners. Add other meals and diets later on the Household page.',
        ),
      ).toBeInTheDocument()
      // A refresh would let the page redirect a member to Today before step 4.
      expect(mockPush).not.toHaveBeenCalled()
      expect(mockRefresh).not.toHaveBeenCalled()
    })

    it('shows loading state during submission', async () => {
      mockFetch.mockImplementation(
        () =>
          new Promise((resolve) =>
            setTimeout(() => resolve(respondOk({ id: 'household-123' })), 100),
          ),
      )

      renderFlow()
      await goToStep3()
      await userEvent.click(screen.getByRole('button', { name: 'Continue' }))

      expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled()
    })

    it('shows the message the route sent', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        json: () => Promise.resolve({ error: 'Validation failed', message: 'Invalid data' }),
      })

      renderFlow()
      await goToStep3()
      await userEvent.click(screen.getByRole('button', { name: 'Continue' }))

      await waitFor(() => {
        expect(screen.getByRole('alert')).toHaveTextContent('Invalid data')
      })
    })

    it('returns focus to Continue after a failed create', async () => {
      let rejectRequest!: (reason: Error) => void
      mockFetch.mockReturnValue(
        new Promise((_, reject) => {
          rejectRequest = reject
        }),
      )

      renderFlow()
      await goToStep3()
      await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
      expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled()
      dropFocusToBody()

      await act(async () => rejectRequest(new Error('Network error')))

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Continue' })).toHaveFocus()
      })
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Unable to connect. Please check your internet connection.',
      )
    })

    it('returns focus to Continue after the route answers with an error', async () => {
      let resolveRequest!: (value: unknown) => void
      mockFetch.mockReturnValue(
        new Promise((resolve) => {
          resolveRequest = resolve
        }),
      )

      renderFlow()
      await goToStep3()
      await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
      dropFocusToBody()

      await act(async () =>
        resolveRequest({
          ok: false,
          json: () => Promise.resolve({ error: 'Validation failed' }),
        }),
      )

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Continue' })).toHaveFocus()
      })
      // The raw `error` field is a machine code or untranslated English, so
      // it must not reach the user — the translated string does.
      expect(screen.getByRole('alert')).toHaveTextContent(
        "We couldn't create your household. Try again.",
      )
    })

    it('goes to Today if the user already has a household', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        json: () =>
          Promise.resolve({
            error: 'already_in_household',
            message: 'You are already a member of a household.',
          }),
      })

      renderFlow()
      await goToStep3()
      await userEvent.click(screen.getByRole('button', { name: 'Continue' }))

      await waitFor(() => {
        expect(mockPush).toHaveBeenCalledWith('/')
        expect(mockRefresh).toHaveBeenCalled()
      })
    })

    // Step 1 has no submit button, so Enter in the name input submits the form
    // implicitly. It must mean Continue, not create (HON-836).
    describe('Enter key', () => {
      it('moves from step 1 to step 2 without creating the household', async () => {
        renderFlow()

        await userEvent.type(screen.getByLabelText('Household name'), '{Enter}')

        expect(mockFetch).not.toHaveBeenCalled()
        expect(screen.getByText('Step 2 of 4')).toBeInTheDocument()
        expect(
          screen.getByRole('heading', { level: 1, name: "Who's at your table?" }),
        ).toHaveFocus()
      })

      it('shows the name-required error and stays on step 1 when the name is empty', async () => {
        renderFlow()

        const nameInput = screen.getByLabelText('Household name')
        // The input is `required`. user-event submits without running the
        // browser's constraint validation, which would otherwise block the
        // submit with its own bubble, so pin the opt-out that keeps a browser
        // on this path too.
        expect(nameInput.closest('form')).toHaveAttribute('novalidate')
        await userEvent.clear(nameInput)
        await userEvent.type(nameInput, '{Enter}')

        expect(mockFetch).not.toHaveBeenCalled()
        expect(screen.getByRole('alert')).toHaveTextContent('Household name is required')
        expect(screen.getByText('Step 1 of 4')).toBeInTheDocument()
      })

      it('ignores a submit inside the transition window after Enter advances', async () => {
        renderFlow()

        await userEvent.type(screen.getByLabelText('Household name'), '{Enter}')
        fireEvent.submit(screen.getByRole('button', { name: 'Continue' }).closest('form')!)
        // The mutation calls fetch asynchronously, so let it run before asserting.
        await act(async () => {
          await vi.advanceTimersByTimeAsync(0)
        })

        expect(mockFetch).not.toHaveBeenCalled()
        expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled()
      })

      it('moves from step 2 to step 3 on Enter in a member name input, without creating', async () => {
        renderFlow()
        await goToStep2()
        await userEvent.click(screen.getByRole('button', { name: 'Add child' }))
        await userEvent.type(screen.getByLabelText('Child 1 name'), 'Emma{Enter}')
        await act(async () => {
          await vi.advanceTimersByTimeAsync(0)
        })

        expect(mockFetch).not.toHaveBeenCalled()
        expect(screen.getByRole('heading', { level: 1, name: 'Allergies' })).toHaveFocus()
      })

      it('ignores a submit inside the transition window after step 2 advances', async () => {
        renderFlow()
        await goToStep2()

        await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
        fireEvent.submit(screen.getByRole('button', { name: 'Continue' }).closest('form')!)
        await act(async () => {
          await vi.advanceTimersByTimeAsync(0)
        })

        expect(mockFetch).not.toHaveBeenCalled()
        expect(screen.getByText('Step 3 of 4')).toBeInTheDocument()
      })

      // Step 3's create button renders where step 2's Continue was, so the
      // second click of a double-click lands on it (HON-1082 review).
      it('ignores the second click of a double-click on step 2 Continue', async () => {
        mockFetch.mockResolvedValue(respondOk({ id: 'household-123' }))
        renderFlow()
        await goToStep2()

        await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
        await act(async () => {
          await vi.advanceTimersByTimeAsync(250)
        })
        await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
        await act(async () => {
          await vi.advanceTimersByTimeAsync(0)
        })

        expect(mockFetch).not.toHaveBeenCalled()
        expect(screen.getByText('Step 3 of 4')).toBeInTheDocument()

        // Once the guard clears, Continue creates as usual.
        await vi.advanceTimersByTimeAsync(600)
        await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
        await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1))
      })

      it('creates on Enter in step 3, with the members typed on step 2', async () => {
        mockFetch.mockResolvedValue(respondOk({ id: 'household-123' }))

        renderFlow()
        await goToStep2()
        await userEvent.click(screen.getByRole('button', { name: 'Add child' }))
        await userEvent.type(screen.getByLabelText('Child 1 name'), 'Emma')
        await continueToStep3()
        screen.getByRole('button', { name: 'Continue' }).focus()
        await userEvent.keyboard('{Enter}')

        await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1))
        expect(householdRequestBody()).toEqual({
          name: "John's household",
          members: [{ name: 'Emma', portionType: 'child' }],
          allergensToAvoid: [],
        })
      })
    })
  })

  describe('Step 3: allergens', () => {
    beforeEach(() => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    async function goToStep3() {
      renderFlow()
      await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
      await vi.advanceTimersByTimeAsync(600)
      await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
      await vi.advanceTimersByTimeAsync(600)
    }

    it('focuses the step title and shows the nine allergens with the AI notice', async () => {
      await goToStep3()

      const title = screen.getByRole('heading', { level: 1, name: 'Allergies' })
      expect(title).toHaveFocus()
      expect(title).toHaveAccessibleDescription('Step 3 of 4')
      const group = screen.getByRole('group', { name: 'Allergens to avoid' })
      expect(within(group).getAllByRole('button')).toHaveLength(9)
      expect(group).toHaveAccessibleDescription(/sent to our AI provider/)
      expect(screen.getByRole('link', { name: 'privacy policy' })).toHaveAttribute(
        'href',
        '/privacy',
      )
      expect(
        screen.getByText(
          'No allergies? Leave everything unticked. You can change this later on the Household page.',
        ),
      ).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Back' })).toBeInTheDocument()
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('sends the ticked allergens with the household', async () => {
      mockFetch.mockResolvedValue(respondOk({ id: 'household-123' }))
      await goToStep3()

      await userEvent.click(screen.getByRole('button', { name: 'Tree nuts' }))
      await userEvent.click(screen.getByRole('button', { name: 'Sesame' }))
      await userEvent.click(screen.getByRole('button', { name: 'Continue' }))

      await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1))
      expect(householdRequestBody().allergensToAvoid).toEqual(['nuts', 'sesame'])
    })

    it('does not send the allergens to analytics', async () => {
      const { track } = await import('@/lib/analytics')
      mockFetch.mockResolvedValue(respondOk({ id: 'household-123' }))
      await goToStep3()

      await userEvent.click(screen.getByRole('button', { name: 'Tree nuts' }))
      await userEvent.click(screen.getByRole('button', { name: 'Continue' }))

      await screen.findByRole('heading', { level: 1, name: 'Plan your first meals' })
      expect(track).toHaveBeenCalledWith('onboarding:household_created', {
        household_id: 'household-123',
      })
    })

    it('keeps the ticked allergens after Back and Continue', async () => {
      await goToStep3()

      await userEvent.click(screen.getByRole('button', { name: 'Tree nuts' }))
      await userEvent.click(screen.getByRole('button', { name: 'Back' }))
      expect(screen.getByRole('heading', { level: 1, name: "Who's at your table?" })).toHaveFocus()
      await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
      await vi.advanceTimersByTimeAsync(600)

      expect(screen.getByRole('button', { name: 'Tree nuts' })).toHaveAttribute(
        'aria-pressed',
        'true',
      )
      expect(screen.getByRole('button', { name: 'Gluten' })).toHaveAttribute(
        'aria-pressed',
        'false',
      )
    })
  })

  describe('Step 4: the first plan', () => {
    beforeEach(() => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    async function goToStep4() {
      mockFetch.mockResolvedValueOnce(respondOk({ id: 'household-123' }))
      renderFlow()
      await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
      await vi.advanceTimersByTimeAsync(600)
      await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
      await vi.advanceTimersByTimeAsync(600)
      await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
      await screen.findByRole('heading', { level: 1, name: 'Plan your first meals' })
    }

    it('generates the plan and lands on Today', async () => {
      await goToStep4()
      mockFetch.mockResolvedValueOnce(respondOk({ id: 'plan-1' }))

      await userEvent.click(screen.getByRole('button', { name: 'Plan my meals' }))

      await waitFor(() => {
        expect(mockPush).toHaveBeenCalledWith('/')
        expect(mockRefresh).toHaveBeenCalled()
      })
      const [url, init] = mockFetch.mock.calls[1]!
      expect(url).toBe('/api/meal-plans/generate')
      expect(JSON.parse(init.body as string)).toEqual(
        expect.objectContaining({
          mode: 'generate',
          startDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
          endDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        }),
      )
    })

    it('offers the weekly reminder unticked, and plans without it', async () => {
      await goToStep4()
      mockFetch.mockResolvedValueOnce(respondOk({ id: 'plan-1' }))

      const optIn = screen.getByRole('checkbox', {
        name: 'Email me on Sundays when next week is not planned yet',
      })
      expect(optIn).not.toBeChecked()
      // The address is confirmed by link first (HON-1113), and this step goes
      // straight to Today, so the checkbox says so.
      expect(optIn).toHaveAccessibleDescription(
        'We email you a link first. The reminder starts after you open it and confirm.',
      )
      await userEvent.click(screen.getByRole('button', { name: 'Plan my meals' }))

      await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/'))
      expect(mockFetch.mock.calls.map(([url]) => url)).not.toContain(
        '/api/households/me/members/me/reminder',
      )
    })

    it('switches the reminder on for Sunday before it generates the plan', async () => {
      await goToStep4()
      mockFetch
        .mockResolvedValueOnce(respondOk({ weekday: 7 }))
        .mockResolvedValueOnce(respondOk({ id: 'plan-1' }))

      await userEvent.click(
        screen.getByRole('checkbox', {
          name: 'Email me on Sundays when next week is not planned yet',
        }),
      )
      await userEvent.click(screen.getByRole('button', { name: 'Plan my meals' }))

      await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/'))
      const [reminderUrl, reminderInit] = mockFetch.mock.calls[1]!
      expect(reminderUrl).toBe('/api/households/me/members/me/reminder')
      expect(reminderInit).toEqual(
        expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ weekday: 7 }) }),
      )
      expect(mockFetch.mock.calls[2]![0]).toBe('/api/meal-plans/generate')
    })

    it('still generates the plan when the reminder fails to save', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {})
      await goToStep4()
      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          json: () => Promise.resolve({ error: 'Failed to save the reminder' }),
        })
        .mockResolvedValueOnce(respondOk({ id: 'plan-1' }))

      await userEvent.click(
        screen.getByRole('checkbox', {
          name: 'Email me on Sundays when next week is not planned yet',
        }),
      )
      await userEvent.click(screen.getByRole('button', { name: 'Plan my meals' }))

      await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/'))
      expect(mockFetch.mock.calls[2]![0]).toBe('/api/meal-plans/generate')
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })

    it('shows the error and returns focus to the button when generation fails', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {})
      await goToStep4()
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ error: 'Internal error' }),
      })

      await userEvent.click(screen.getByRole('button', { name: 'Plan my meals' }))

      await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument())
      expect(screen.getByRole('button', { name: 'Plan my meals' })).toHaveFocus()
      expect(mockPush).not.toHaveBeenCalled()
    })
  })
})
