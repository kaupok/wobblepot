import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  defaultPreferences,
  mockFetch,
  renderSettings,
  stubPointerApis,
} from '@/test/household-settings'

import { FoodPreferencesForm } from './FoodPreferencesForm'

// The global next-intl mock has no `t.rich`, which the allergen notice needs.
// `renderSettings` wraps in a real provider with the English catalogue.
vi.unmock('next-intl')

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    refresh: vi.fn(),
  }),
}))

global.fetch = mockFetch

type Props = Parameters<typeof FoodPreferencesForm>[0]

function renderForm(overrides: Partial<Props> = {}) {
  return renderSettings(
    <FoodPreferencesForm
      preferences={defaultPreferences}
      excludedMatches={[]}
      isOwner
      {...overrides}
    />,
  )
}

/**
 * The help under the notes and ingredients fields of Food preferences: what reads the notes
 * for the AI, and what each ingredient to avoid excludes. The other cases are
 * in `FoodPreferencesForm.test.tsx`.
 */
describe('FoodPreferencesForm field help', () => {
  beforeEach(() => {
    mockFetch.mockReset()
    stubPointerApis()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  // HON-1326: the field reaches only the AI prompts, so its help names what
  // does and does not read it.
  describe('notes for the AI', () => {
    it('describes the AI notes input with what reads it', () => {
      renderForm()

      const notes = screen.getByLabelText('Notes for the AI (optional)')
      expect(notes).toHaveAttribute(
        'placeholder',
        'e.g., Less salt for the kids. Favour high-protein dishes.',
      )
      expect(notes).toHaveAccessibleDescription(
        'The AI follows these notes when it generates a plan, imagines a meal, adjusts a recipe or answers a cooking question. Swap, the recipe list and meals a connected assistant plans do not check them. To keep an ingredient out of every meal, add it to Ingredients to avoid.',
      )
    })

    it('names the field and what reads it in Estonian', () => {
      renderSettings(
        <FoodPreferencesForm preferences={defaultPreferences} excludedMatches={[]} isOwner />,
        'et',
      )

      const notes = screen.getByLabelText('Märkmed AI-le (vabatahtlik)')
      expect(notes).toHaveAttribute(
        'placeholder',
        'nt lastele vähem soola. Eelista valgurikkaid toite.',
      )
      expect(notes).toHaveAccessibleDescription(
        'AI järgib neid märkmeid, kui see koostab plaani, mõtleb välja toidu, kohandab retsepti või vastab küsimusele toiduvalmistamise kohta. Vaheta, retseptide loend ja ühendatud assistendi planeeritud toidud neid ei kontrolli. Et hoida koostisosa kõigist toitudest eemal, lisa see väljale „Koostisosad, mida vältida“.',
      )
    })
  })

  // HON-1321: a tag that matches nothing used to look saved and exclude nothing.
  describe('what each ingredient to avoid excludes', () => {
    const withTags = { ...defaultPreferences, excludedIngredients: ['mushrooms', 'dragonfruit'] }
    const matches = [
      {
        tag: 'mushrooms',
        ingredients: [
          { id: 'ing-1', name: 'chestnut mushroom' },
          { id: 'ing-2', name: 'mushroom' },
        ],
      },
      { tag: 'dragonfruit', ingredients: [] },
    ]
    const matchList = () =>
      screen.getByRole('list', { name: 'What each ingredient to avoid excludes' })

    it('counts the matches of a tag and names them in a disclosure', async () => {
      renderForm({ preferences: withTags, excludedMatches: matches })

      const summary = within(matchList()).getByText('mushrooms: excludes 2 ingredients')
      const names = within(matchList()).getByText('chestnut mushroom, mushroom')
      expect(names).not.toBeVisible()

      await userEvent.click(summary)
      expect(names).toBeVisible()
    })

    it('warns about a tag that matches no ingredient', () => {
      renderForm({ preferences: withTags, excludedMatches: matches })

      expect(
        within(matchList()).getByText(
          'dragonfruit: matches no ingredient, so no meal is excluded.',
        ),
      ).toBeVisible()
    })

    it('says the same in Estonian', () => {
      renderSettings(
        <FoodPreferencesForm preferences={withTags} excludedMatches={matches} isOwner />,
        'et',
      )

      const list = screen.getByRole('list', { name: 'Mida iga välditav koostisosa välistab' })
      expect(within(list).getByText('mushrooms: välistab 2 koostisosa')).toBeInTheDocument()
      expect(
        within(list).getByText(
          'dragonfruit: ükski koostisosa ei sobi, nii et ükski toit ei jää välja.',
        ),
      ).toBeInTheDocument()
    })

    it('shows the matches the save answers for a new tag', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            excludedMatches: [{ tag: 'pork', ingredients: [{ id: 'ing-3', name: 'pork belly' }] }],
          }),
      })
      renderForm()
      expect(
        screen.queryByRole('list', { name: 'What each ingredient to avoid excludes' }),
      ).not.toBeInTheDocument()

      await userEvent.type(screen.getByLabelText('Ingredients to avoid (optional)'), 'pork{Enter}')
      expect(
        screen.queryByRole('list', { name: 'What each ingredient to avoid excludes' }),
      ).not.toBeInTheDocument()
      await userEvent.click(screen.getByRole('button', { name: 'Save' }))

      expect(
        await within(
          await screen.findByRole('list', {
            name: 'What each ingredient to avoid excludes',
          }),
        ).findByText('pork: excludes 1 ingredient'),
      ).toBeInTheDocument()
    })
  })
})
