// ROUTES: /sign-up, /onboarding, /, /shopping, /recipes/imagine · COMPONENTS: SignUpForm, FirstTimeSetup, TimelineView, MealCard, MealDetailModal, IngredientList, ShoppingSection, CategoryGroup, PantrySection, ImagineClient
import { test, expect } from '@playwright/test'
import { signUpWithHousehold } from './utils/test-helpers'
import { mealTranslationsEt } from '../../prisma/seed-meal-translations-et'
import { ingredientTranslationsEt } from '../../prisma/seed-ingredient-translations-et'

/**
 * HON-547 — the automated proof that Estonian renders across the core flow.
 * This green = HON-499 "translation-complete" is provable (the *human* partner
 * test is HON-512, under the HON-545 quality epic).
 *
 * Tagged `@ai`: it drives real Claude calls (plan generate + imagine), so it is
 * excluded from the per-push tier-1 run (`--grep-invert=@ai`) for cost — it is a
 * local / on-demand gate. NOT `@smoke`: sign-up needs the test-only
 * `/api/e2e-seed` invite endpoint (ci/test/dev only), so it cannot run against
 * the shared preview/staging environments the smoke tiers target.
 *
 * Locale is forced via `PATCH /api/households/me { locale: 'et' }` after
 * onboarding, because onboarding clamps non-public locales to `en`
 * (isEffectivelyPublicLocale) and `et` is not yet public — and the public flip
 * (HON-549) is blocked by this very spec, so we must not depend on it.
 *
 * Assertions cross-reference the rendered UI against the seeded `et` translation
 * tables (imported as plain data) so they stay deterministic despite random AI
 * meal selection. Minor untranslated chrome is tolerated (quality, not coverage).
 */

// Estonian-specific letters — a robust "is this Estonian?" signal for the
// non-deterministic AI imagine output (õ/ä/ö/ü do not occur in English words).
const ESTONIAN_LETTERS = /[äöõüÄÖÕÜ]/

// IngredientCategory → Estonian enum label (messages/et.json `enums.IngredientCategory`).
const CATEGORY_ET: Record<string, string> = {
  protein: 'Valgud',
  vegetable: 'Aedviljad',
  fruit: 'Puuviljad',
  dairy: 'Piimatooted',
  carb: 'Süsivesikud',
  legume: 'Kaunviljad',
  fat: 'Õlid ja rasvad',
  condiment: 'Kastmed',
  spice: 'Vürtsid',
}

interface EntryComponent {
  quantityPerServing: number
  isVague: boolean
  ingredient: { name: string; category: string; defaultUnit: 'g' | 'piece' }
}
interface Entry {
  servingOverride: number | null
  meal: { name: string; description: string | null; components: EntryComponent[] } | null
}

// Mirror IngredientList's piece-quantity formatting (locale `et`, max 1 fraction
// digit) so the predicted decimal string matches what the component renders.
const fmtEtQty = (n: number) => new Intl.NumberFormat('et', { maximumFractionDigits: 1 }).format(n)

test.describe(
  '@i18n full-flow — Estonian renders across the core flow',
  { tag: ['@i18n', '@ai'] },
  () => {
    test.use({ locale: 'et-EE' })

    test('sign up → set et → generate → plan, shopping, pantry, meal detail, imagine all render Estonian', async ({
      page,
    }) => {
      test.setTimeout(180_000) // two real Claude calls: plan generate + imagine

      // Seeded lookup tables (plain data files — no Prisma client, import-safe).
      const etMeals = new Map(mealTranslationsEt.map((m) => [m.et.name, m.et]))
      const etMealNames = new Set(mealTranslationsEt.map((m) => m.et.name))
      const enMealNames = new Set(mealTranslationsEt.map((m) => m.enName))
      const etIngredientNames = new Set(ingredientTranslationsEt.map((i) => i.et))
      const enIngredientNames = new Set(ingredientTranslationsEt.map((i) => i.en))

      // ── 1. Sign up + onboarding. Onboarding clamps the household to `en`. ──
      await signUpWithHousehold(page)

      // ── 2. Generate the first plan while still `en`: the English "Generate
      //       meal plan" CTA is a stable selector. Entries are locale-independent
      //       — only their *display* flips once we switch the household to et. ──
      await page.goto('/')
      await expect(page.getByRole('heading', { name: /^Welcome to Wobblepot/ })).toBeVisible()
      const [generateResponse] = await Promise.all([
        page.waitForResponse(
          (r) => r.url().endsWith('/api/meal-plans/generate') && r.request().method() === 'POST',
          { timeout: 90_000 },
        ),
        page.getByRole('button', { name: 'Generate meal plan' }).click(),
      ])
      expect(generateResponse.ok()).toBe(true)
      await expect(page.getByRole('heading', { name: /^Welcome to Wobblepot/ })).toBeHidden()

      // ── 3. Force the household locale to `et` (documented opt-in path). ──
      const patch = await page.request.patch('/api/households/me', { data: { locale: 'et' } })
      expect(patch.ok(), 'PATCH /api/households/me { locale: et } should succeed').toBe(true)
      expect((await patch.json()).locale).toBe('et')

      // ── 4. Reload → server resolves the household locale → Estonian chrome. ──
      await page.goto('/')
      await expect(page.locator('html')).toHaveAttribute('lang', 'et')

      // ── 5. Read the generated entries (now et-translated by /api/entries). ──
      const today = new Date()
      const windowStart = new Date(today)
      windowStart.setDate(windowStart.getDate() - 7)
      const windowEnd = new Date(today)
      windowEnd.setDate(windowEnd.getDate() + 15)
      const fmtDate = (d: Date) => d.toISOString().slice(0, 10)
      const entriesResponse = await page.request.get(
        `/api/entries?startDate=${fmtDate(windowStart)}&endDate=${fmtDate(windowEnd)}`,
      )
      expect(entriesResponse.ok()).toBe(true)
      const { entries } = (await entriesResponse.json()) as { entries: Entry[] }
      const mealEntries = entries.filter((e): e is Entry & { meal: NonNullable<Entry['meal']> } =>
        Boolean(e.meal),
      )
      expect(mealEntries.length, 'generated plan should contain meals').toBeGreaterThan(0)

      // ── 6. Meal plan: a card shows a seeded *Estonian* meal name. Prefer an
      //       entry that proves name + description + ingredient localization in
      //       one modal, using distinctly-Estonian strings (et ≠ en) so it can't
      //       pass on an English echo. ──
      const distinctlyEtIngredient = (e: Entry & { meal: NonNullable<Entry['meal']> }) =>
        e.meal.components
          .map((c) => c.ingredient.name)
          .find((n) => etIngredientNames.has(n) && !enIngredientNames.has(n))

      const nameEntry =
        mealEntries.find(
          (e) =>
            etMealNames.has(e.meal.name) &&
            !enMealNames.has(e.meal.name) &&
            !!etMeals.get(e.meal.name)?.description &&
            !!distinctlyEtIngredient(e),
        ) ??
        mealEntries.find(
          (e) =>
            etMealNames.has(e.meal.name) &&
            !enMealNames.has(e.meal.name) &&
            !!etMeals.get(e.meal.name)?.description,
        ) ??
        mealEntries.find(
          (e) => etMealNames.has(e.meal.name) && !!etMeals.get(e.meal.name)?.description,
        )
      expect(
        nameEntry,
        'No generated entry surfaced a seeded Estonian meal name with a description. ' +
          'If persistent: /api/entries may not be translating (HON-547 regression) or HON-507 coverage dropped.',
      ).toBeTruthy()
      const etMealName = nameEntry!.meal.name
      const etMealDescription = etMeals.get(etMealName)!.description!
      const etIngredientInMeal = distinctlyEtIngredient(nameEntry!)

      // The MealCard renders the meal name as the button that opens its detail modal.
      await expect(
        page.getByRole('button', { name: etMealName, exact: true }).first(),
      ).toBeVisible()

      // ── 7. Meal detail: et name (dialog title), et description, and et
      //       ingredient names all render — the timeline detail is fully
      //       localized, not just the title (HON-547 review). ──
      await page.getByRole('button', { name: etMealName, exact: true }).first().click()
      const detailDialog = page.getByRole('dialog')
      await expect(detailDialog).toBeVisible()
      await expect(detailDialog.getByRole('heading', { name: etMealName })).toBeVisible()
      await expect(detailDialog.getByText(etMealDescription)).toBeVisible()
      if (etIngredientInMeal) {
        await expect(detailDialog.getByText(etIngredientInMeal).first()).toBeVisible()
      }
      await page.keyboard.press('Escape')
      await expect(detailDialog).toBeHidden()

      // ── 8. Comma-decimal numbers: open a meal whose piece quantity is
      //       fractional and assert it renders with an Estonian decimal comma. ──
      const membersResponse = await page.request.get('/api/households/me/members')
      expect(membersResponse.ok()).toBe(true)
      const { members } = (await membersResponse.json()) as { members: unknown[] }
      const householdSize = members.length

      let commaTarget: { name: string; expected: string } | null = null
      for (const e of mealEntries) {
        if (!etMealNames.has(e.meal.name)) continue
        const servings = e.servingOverride ?? householdSize
        const comp = e.meal.components.find(
          (c) =>
            c.ingredient.defaultUnit === 'piece' &&
            !c.isVague &&
            !Number.isInteger(c.quantityPerServing * servings),
        )
        if (comp) {
          commaTarget = {
            name: e.meal.name,
            expected: fmtEtQty(comp.quantityPerServing * servings),
          }
          break
        }
      }
      expect(
        commaTarget,
        'No generated meal had a fractional piece quantity to prove comma-decimal formatting; re-run (AI generations vary).',
      ).toBeTruthy()
      expect(commaTarget!.expected).toContain(',') // sanity: Estonian decimal separator

      await page.getByRole('button', { name: commaTarget!.name, exact: true }).first().click()
      const commaDialog = page.getByRole('dialog')
      await expect(commaDialog).toBeVisible()
      await expect(
        commaDialog.getByText(commaTarget!.expected, { exact: false }).first(),
      ).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(commaDialog).toBeHidden()

      // ── 9. Shopping list: Estonian chrome, category headers, ingredient names. ──
      await page.goto('/shopping')
      await expect(page.locator('html')).toHaveAttribute('lang', 'et')
      await expect(page.getByRole('heading', { name: 'Poenimekiri' })).toBeVisible() // shopping list
      await expect(page.getByRole('heading', { name: 'Sinu sahver' })).toBeVisible() // your pantry

      // Category headers render the Estonian enum labels. Restrict the match to
      // categories the plan actually uses so it can't pass on stray chrome.
      const planCategories = new Set(
        mealEntries.flatMap((e) => e.meal.components.map((c) => c.ingredient.category)),
      )
      const expectedCategoryLabels = [...planCategories].map((c) => CATEGORY_ET[c]).filter(Boolean)
      expect(expectedCategoryLabels.length).toBeGreaterThan(0)
      await expect(
        page.getByText(new RegExp(expectedCategoryLabels.join('|'))).first(),
      ).toBeVisible()

      // Ingredient names: the shopping-list API returns et-translated names. Pick a
      // distinctly-Estonian one, assert it renders, and capture its id for pantry.
      const shopping = (await (await page.request.get('/api/shopping-list?days=7')).json()) as {
        groups: { items: { ingredientId: string; name: string }[] }[]
      }
      const shoppingItems = shopping.groups.flatMap((g) => g.items)
      const etItem = shoppingItems.find(
        (i) => etIngredientNames.has(i.name) && !enIngredientNames.has(i.name),
      )
      expect(
        etItem,
        'Shopping list surfaced no distinctly-Estonian ingredient name (HON-506 / shopping-list locale threading).',
      ).toBeTruthy()
      await expect(page.getByText(etItem!.name).first()).toBeVisible()

      // ── 10. Mark the item purchased → it lands in the pantry. ──
      const itemRow = page.locator('label').filter({ hasText: etItem!.name }).first()
      await expect(itemRow).toBeVisible()
      const [purchaseResponse] = await Promise.all([
        page.waitForResponse(
          (r) => r.url().endsWith('/api/shopping-list/purchase') && r.request().method() === 'POST',
        ),
        itemRow.getByRole('checkbox').click(),
      ])
      expect(purchaseResponse.ok()).toBe(true)

      // The pantry received it (server-persisted) — /api/pantry now lists the ingredient.
      await expect
        .poll(
          async () => {
            const pantry = (await (await page.request.get('/api/pantry')).json()) as {
              items: { ingredient: { id: string } }[]
            }
            return pantry.items.some((it) => it.ingredient.id === etItem!.ingredientId)
          },
          { message: 'purchased shopping-list item should appear in the pantry' },
        )
        .toBe(true)

      // ── 11. Imagine a meal: AI output is Estonian. ──
      await page.goto('/recipes/imagine')
      await expect(page.locator('html')).toHaveAttribute('lang', 'et')
      const promptBox = page.locator('textarea').first()
      await promptBox.fill('Kiire ja tervislik õhtusöök kanaga')
      // Enter (no shift) triggers generation — locale-stable, no reliance on the
      // translated button label.
      const [imagineResponse] = await Promise.all([
        page.waitForResponse(
          (r) => r.url().endsWith('/api/meals/imagine') && r.request().method() === 'POST',
          { timeout: 90_000 },
        ),
        promptBox.press('Enter'),
      ])
      expect(imagineResponse.ok()).toBe(true)
      const imagined = (await imagineResponse.json()) as {
        meals: { name: string; description: string | null }[]
      }
      expect(imagined.meals.length, 'imagine should return at least one meal').toBeGreaterThan(0)

      // The combined AI output (names + descriptions) contains Estonian letters.
      const imaginedText = imagined.meals.map((m) => `${m.name} ${m.description ?? ''}`).join(' ')
      expect(
        ESTONIAN_LETTERS.test(imaginedText),
        `Imagined meal output did not look Estonian: "${imaginedText.slice(0, 200)}"`,
      ).toBe(true)

      // …and the first imagined meal renders on the page.
      await expect(page.getByText(imagined.meals[0]!.name).first()).toBeVisible()

      // ── 12. <html lang="et"> held throughout the flow. ──
      await expect(page.locator('html')).toHaveAttribute('lang', 'et')
    })
  },
)
