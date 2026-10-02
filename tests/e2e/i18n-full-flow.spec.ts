// ROUTES: /sign-up, /onboarding, /, /shopping, /recipes/imagine, /api/meal-plans/[id]/entries, /api/meals, /api/ingredients, /api/pantry · COMPONENTS: SignUpForm, FirstTimeSetup, TimelineView, MealCard, MealDetailModal, MealSelectorModal, IngredientList, ShoppingSection, CategoryGroup, PantrySection, InlineAddItem, ImagineClient
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
 * As of HON-549 the public flip has shipped: `PUBLIC_LOCALES = ['en', 'et']`
 * and the onboarding clamp is gone. The Estonian Accept-Language header now
 * round-trips into `Household.locale = 'et'` during sign-up, so no manual
 * locale forcing is needed.
 *
 * Assertions cross-reference the rendered UI against the seeded `et` translation
 * tables (imported as plain data) so they stay deterministic despite random AI
 * meal selection. Minor untranslated chrome is tolerated (quality, not coverage).
 *
 * The comma-decimal step does not search the generated plan: the model rarely
 * picks a meal with a fractional piece quantity, so the step failed on most
 * runs for reasons unrelated to the release (HON-887). It adds its own entry
 * with a seeded system meal instead, on the generated plan's page.
 *
 * The searches (meal selector, pantry inline add) type a seeded Estonian name
 * and expect it back, so they depend on the translated-name search from
 * HON-911. Pantry and search assertions read the screen, not the API: the
 * audit that added them (HON-915) found bugs an API-only check could not see.
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
  date: string
  mealType: string
  meal: { name: string; description: string | null; components: EntryComponent[] } | null
}
interface SystemMeal {
  id: string
  name: string
  components: {
    quantityPerServing: number
    // `/api/meals` omits it today; seeded system meals are never vague.
    isVague?: boolean
    ingredient: { defaultUnit: 'g' | 'piece' }
  }[]
}

const MEAL_TYPES = ['breakfast', 'lunch', 'dinner'] as const

// Mirror IngredientList's piece-quantity formatting (locale `et`, max 1 fraction
// digit) so the predicted decimal string matches what the component renders.
const fmtEtQty = (n: number) => new Intl.NumberFormat('et', { maximumFractionDigits: 1 }).format(n)
// The cook view labels a piece count "1,5 tk" on a no-break space (HON-956);
// Playwright folds that into a regular space when it matches text.
const fmtEtPieces = (n: number) => `${fmtEtQty(n)} tk`

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

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

      // ── 1. Sign up + onboarding. With HON-549 shipped, the Estonian
      //       Accept-Language header (`test.use({ locale: 'et-EE' })`)
      //       round-trips into `Household.locale = 'et'` directly. ──
      await signUpWithHousehold(page)

      // ── 2. Confirm Estonian chrome is live before generating the plan. ──
      await page.goto('/')
      await expect(page.locator('html')).toHaveAttribute('lang', 'et')
      await expect(page.getByRole('heading', { name: /^Tere tulemast Wobblepotti/ })).toBeVisible()

      // ── 3. Generate the first plan via the Estonian CTA. ──
      const [generateResponse] = await Promise.all([
        page.waitForResponse(
          (r) => r.url().endsWith('/api/meal-plans/generate') && r.request().method() === 'POST',
          { timeout: 90_000 },
        ),
        page.getByRole('button', { name: 'Loo söögiplaan' }).click(),
      ])
      expect(generateResponse.ok()).toBe(true)
      await expect(page.getByRole('heading', { name: /^Tere tulemast Wobblepotti/ })).toBeHidden()

      // ── 4. Read the generated entries (et-translated by /api/entries). ──
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
      const { entries, planId } = (await entriesResponse.json()) as {
        entries: Entry[]
        planId: string | null
      }
      const mealEntries = entries.filter((e): e is Entry & { meal: NonNullable<Entry['meal']> } =>
        Boolean(e.meal),
      )
      expect(mealEntries.length, 'generated plan should contain meals').toBeGreaterThan(0)

      // ── 5. Meal plan: a card shows a seeded *Estonian* meal name. Prefer an
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

      // ── 6. Meal detail: et name (dialog title), et description, and et
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

      // ── 7. Comma-decimal numbers: add an entry with a seeded meal whose piece
      //       quantity is fractional, open it, and assert the quantity renders
      //       with an Estonian decimal comma. The fixture is chosen from seed data
      //       by predicate, so this step does not depend on what the AI planned. ──
      expect(planId, 'plan generation should have created a meal plan').toBeTruthy()
      const membersResponse = await page.request.get('/api/households/me/members')
      expect(membersResponse.ok()).toBe(true)
      const { members } = (await membersResponse.json()) as { members: unknown[] }
      const householdSize = members.length

      // A meal already in the plan would put two cards with the same name on the
      // timeline, so the fixture is limited to meals the model did not pick.
      const plannedMealNames = new Set(mealEntries.map((e) => e.meal.name))
      let commaTarget: { mealId: string; name: string; expected: string } | null = null
      for (let offset = 0; !commaTarget; offset += 50) {
        const mealsResponse = await page.request.get(
          `/api/meals?source=system&limit=50&offset=${offset}`,
        )
        expect(mealsResponse.ok()).toBe(true)
        const { meals, hasMore } = (await mealsResponse.json()) as {
          meals: SystemMeal[]
          hasMore: boolean
        }
        for (const meal of meals) {
          if (!etMealNames.has(meal.name) || plannedMealNames.has(meal.name)) continue
          const comp = meal.components.find(
            (c) =>
              c.ingredient.defaultUnit === 'piece' &&
              !c.isVague &&
              !Number.isInteger(c.quantityPerServing * householdSize) &&
              fmtEtQty(c.quantityPerServing * householdSize).includes(','),
          )
          if (comp) {
            commaTarget = {
              mealId: meal.id,
              name: meal.name,
              expected: fmtEtPieces(comp.quantityPerServing * householdSize),
            }
            break
          }
        }
        if (!hasMore) break
      }
      expect(
        commaTarget,
        `No seeded system meal has an Estonian name and a piece component whose quantity for ${householdSize} ` +
          'member(s) renders with a decimal comma (e.g. avocado 0.5 in prisma/seed-expansion.ts). ' +
          'Check the seed data and the et meal translations.',
      ).toBeTruthy()

      // The latest free slot inside the timeline's 14-day window. Generation fills
      // the near days, so this leaves every generated entry (and the shopping list
      // step 8 reads) untouched. Offsets stop at 13 so the UTC dates below cannot
      // fall past the window's last day.
      const occupied = new Set(entries.map((e) => `${e.date}|${e.mealType}`))
      let slot: { date: string; mealType: (typeof MEAL_TYPES)[number] } | null = null
      for (let dayOffset = 13; dayOffset >= 1 && !slot; dayOffset--) {
        const day = new Date(today)
        day.setDate(day.getDate() + dayOffset)
        const mealType = MEAL_TYPES.find((mt) => !occupied.has(`${fmtDate(day)}|${mt}`))
        if (mealType) slot = { date: fmtDate(day), mealType }
      }
      expect(
        slot,
        'no free meal slot in the next 13 days for the comma-decimal fixture',
      ).toBeTruthy()

      let fixtureEntryId: string | null = null
      try {
        const createResponse = await page.request.post(`/api/meal-plans/${planId}/entries`, {
          data: { date: slot!.date, mealType: slot!.mealType, mealId: commaTarget!.mealId },
        })
        expect(
          createResponse.ok(),
          `Creating the comma-decimal fixture entry failed with ${createResponse.status()}`,
        ).toBe(true)
        fixtureEntryId = ((await createResponse.json()) as { id: string }).id

        // The timeline's query cache predates the API-created entry.
        await page.reload()
        await page.getByRole('button', { name: commaTarget!.name, exact: true }).click()
        const commaDialog = page.getByRole('dialog')
        await expect(commaDialog).toBeVisible()
        await expect(
          commaDialog.getByText(commaTarget!.expected, { exact: false }).first(),
        ).toBeVisible()
        await page.keyboard.press('Escape')
        await expect(commaDialog).toBeHidden()

        // ── 7b. Meal selector search by an Estonian name. Swap on the fixture
        //        card opens the selector; its search is filtered by the entry's
        //        meal type, so the target is a system meal suitable for that
        //        slot, with an Estonian name that differs from the English one
        //        (an English match cannot satisfy it). ──
        const slotMealsResponse = await page.request.get(
          `/api/meals?source=system&mealType=${slot!.mealType}&limit=50`,
        )
        expect(slotMealsResponse.ok()).toBe(true)
        const { meals: slotMeals } = (await slotMealsResponse.json()) as { meals: SystemMeal[] }
        const searchTarget = slotMeals.find(
          (m) =>
            etMealNames.has(m.name) && !enMealNames.has(m.name) && m.name !== commaTarget!.name,
        )
        expect(
          searchTarget,
          `No seeded ${slot!.mealType} system meal has a distinctly-Estonian name to search for.`,
        ).toBeTruthy()

        const fixtureCard = page
          .locator('[data-slot="card"]')
          .filter({ has: page.getByRole('button', { name: commaTarget!.name, exact: true }) })
        await fixtureCard
          .getByRole('button', { name: `Rohkem toiminguid: ${commaTarget!.name}` }) // more actions
          .click()
        await page.getByRole('menuitem', { name: 'Vaheta' }).click() // swap
        const selectorDialog = page.getByRole('dialog')
        await expect(selectorDialog).toBeVisible()
        await selectorDialog
          .getByRole('searchbox', { name: 'Otsi retseptide hulgast' }) // search meal library
          .fill(searchTarget!.name)
        // The header gains its count ("Otsingutulemused (N)") only once the
        // search response is in — while loading it reads "Otsingutulemused" —
        // so the name below cannot come from the suggestion list.
        await expect(selectorDialog.getByText(/^Otsingutulemused \(\d+\)/)).toBeVisible()
        await expect(
          selectorDialog.getByText(searchTarget!.name, { exact: true }).first(),
        ).toBeVisible()
        await page.keyboard.press('Escape')
        await expect(selectorDialog).toBeHidden()
      } finally {
        if (fixtureEntryId) {
          await page.request.delete(`/api/meal-plans/${planId}/entries/${fixtureEntryId}`)
        }
      }

      // ── 8. Shopping list: Estonian chrome, category headers, ingredient names. ──
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

      // ── 9. Mark the item purchased → it lands in the pantry. ──
      const itemRow = page.locator('label').filter({ hasText: etItem!.name }).first()
      await expect(itemRow).toBeVisible()
      const [purchaseResponse] = await Promise.all([
        page.waitForResponse(
          (r) => r.url().endsWith('/api/shopping-list/purchase') && r.request().method() === 'POST',
        ),
        itemRow.getByRole('checkbox').click(),
      ])
      expect(purchaseResponse.ok()).toBe(true)

      // The pantry column shows it under its Estonian name, without a reload:
      // the row is built from the purchase response, so an English name there
      // would show until the page is refreshed. Scoped to the column, since the
      // shopping list beside it renders the same name.
      const pantryColumn = page.getByTestId('pantry-column')
      await expect(pantryColumn.getByText(etItem!.name, { exact: true })).toBeVisible()

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

      // ── 9b. Pantry inline add: search by an Estonian ingredient name, add the
      //        result, and see the row land in Estonian without a reload (the
      //        row comes from the POST /api/pantry response). ──
      const addTarget = ['potato', 'carrot', 'onion', 'garlic']
        .map((en) => ingredientTranslationsEt.find((i) => i.en === en))
        .find((i) => i && i.et !== i.en && i.et !== etItem!.name)!
      expect(addTarget, 'no seeded ingredient with a distinct Estonian name to add').toBeTruthy()
      await pantryColumn
        .getByRole('textbox', { name: 'Lisa koostisosa sahvrisse' }) // add ingredient to pantry
        .fill(addTarget.et)
      const addOption = pantryColumn.getByRole('button', {
        name: new RegExp(`^${escapeRegExp(addTarget.et)}(\\s|$)`),
      })
      await expect(addOption).toBeVisible()
      const [pantryAddResponse] = await Promise.all([
        page.waitForResponse(
          (r) => r.url().endsWith('/api/pantry') && r.request().method() === 'POST',
        ),
        addOption.click(),
      ])
      expect(pantryAddResponse.ok()).toBe(true)
      await expect(pantryColumn.getByText(addTarget.et, { exact: true })).toBeVisible()

      // ── 10. Imagine a meal: AI output is Estonian. ──
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

      // ── 11. <html lang="et"> held throughout the flow. ──
      await expect(page.locator('html')).toHaveAttribute('lang', 'et')
    })
  },
)
