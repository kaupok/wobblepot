# Wobblepot: AI-Powered Family Meal Planning

> **Naming note:** **Wobblepot** (pronounced "WOB-bul-pot") is the user-facing product brand. _Honkadori OÜ_ is the parent legal entity — used for vendor accounts (PostHog org, Neon org, etc.), DPAs, subprocessor listings, AKI registration. All user-facing copy and email lives on `wobblepot.com`; staging is on `wobblepot.dev`. Legal-entity attribution (Honkadori OÜ) appears in policy text, not in the email address. Brand decision recorded in HON-539; in-code brand swap completed in HON-538; staging migration completed in HON-542.

## Current Status

**Mode:** Launch readiness for public EU beta — first cohort by invitation only.

Foundation and core flows are complete (AI planning, shopping, pantry, auth, household management). Open work is the launch-readiness band: GDPR/legal, production observability, abuse protection, email deliverability, and launch hygiene (metadata, uptime). Target launch geography is EU-wide including UK-GDPR — the compliance bar is the full GDPR surface, not "soft launch to friends". The bar is set at public-beta because retrofitting compliance later is worse than paying the cost upfront.

Sign-up is gated behind single-use invite codes (HON-488) controlled by the `invite_code_required` PostHog kill-switch (default `true`). Flipping the flag to `false` opens public sign-up without a deploy; flipping back re-locks. This shrinks blast radius for the first cohort while keeping us one toggle away from open beta. A visitor without a code can join the waitlist at `/request-invite` and confirm by an emailed link (HON-846); the admin picks who to invite (HON-970). A household invite link also admits one account: the owner vouches for the invitee, so the link replaces the code and the sign-up joins the invitee to the owner's household (HON-1131).

---

## Vision

### Problem

- Daily "what's for dinner" decision fatigue
- Grocery management (lists, forgotten items, multiple trips)
- Nutrition balance for families with dietary/macro preferences
- Time constraints (45-60 min cooking window)
- Kid-friendly meal considerations

### Target Users

Target audience for public EU beta: families with young children across EU/EEA and UK. The first cohort joins by invitation only — admin mints `SignupCode` rows at `/admin/signup-codes` and shares them out-of-band; signups without a code return 403 while `invite_code_required` is `true`.

### Core Value Proposition

AI-powered meal planning that generates personalized ingredient-based meal plans with nutritional transparency.

### Differentiators

- True AI personalization (vs static meal databases)
- Simplicity and speed (minimal friction)
- Family-focused features
- Flexibility to adjust plans
- No VC bloat - simple, clean, user-friendly

### Brand voice and tone

**Voice:** Warm, family-coded, playful, kitchen-evocative. The name itself paints the image — a pot wobbling on the stove, Roald-Dahl-character energy. Sits alongside the parent entity Honkadori (a term from Japanese waka poetry meaning "allusive variation" — referencing a foundational poem to create something new) — both names favor character and resonance over generic descriptors.

**Tone in marketing and long-form copy:**

- Plain language over jargon. Avoid food-industry buzzwords ("artisanal," "curated," "elevated").
- Direct and helpful, not aspirational. Users are tired parents at 5pm, not lifestyle-magazine readers.
- Light-touch personality: a small playful turn of phrase is welcome; constant whimsy is not.
- Never precious about the AI angle. AI is the engine, not the story.

**Tone in product chrome (buttons, labels, errors):**

- Sentence case throughout (per CLAUDE.md text-casing rule).
- Imperative for actions ("Add meal," "Skip dinner").
- Friendly but operational for empty states and errors — explain what happened and what to do next, not what went wrong technically.

**Pronunciation:** "WOB-bul-pot" — three syllables, stress on the first.

---

## Domain Glossary

| Term                | Definition                                                                                                                                                                        |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Plan**            | The household's single `MealPlan`. It has no dates of its own; its entries cover any days.                                                                                        |
| **Meal**            | Template: ingredient combination with per-serving quantities. Reusable across days.                                                                                               |
| **Recipe**          | User-facing name for a household's own Meal in My recipes. Meal stays the model name.                                                                                             |
| **Entry**           | Instance: meal assigned to a date + mealType with status (planned/completed/skipped).                                                                                             |
| **Slot**            | A date + mealType position.                                                                                                                                                       |
| **Fridge meal**     | An entry with no meal: items from the pantry, an earlier meal's leftovers, or free text (`kind`). A leftover item may point at a dinner still planned, with the servings it takes |
| **Extra**           | A snack or drink on a day, outside its meals: an ingredient with an optional amount, or free text.                                                                                |
| **SlotRequirement** | Slot with required protein type (dinner-only, for balance).                                                                                                                       |
| **Component**       | Meal-to-ingredient link with `quantityPerServing`, in the ingredient's `defaultUnit`.                                                                                             |
| **Candidate**       | Meal that passed the hard filters: eligible for AI selection in generation, and for swap ranking.                                                                                 |
| **Pool**            | Candidates filtered by protein type (fish, legume, any).                                                                                                                          |
| **Staple**          | Pantry item the household always keeps at home; on the shopping list only when marked ran out (`0`).                                                                              |
| **Rolling window**  | Shopping aggregation: today through 7 or 14 days ahead (`src/app/shopping/load-inventory.ts`).                                                                                    |
| **Urgency bucket**  | Shopping grouping: today / tomorrow / this-week / later (`getUrgencyBucket`, `meal-planning/dates`).                                                                              |

### Quantity Units

`MealComponent.quantityPerServing`, pantry stock, and shopping quantities all use the ingredient's `defaultUnit`: a piece count for a `piece` ingredient (eggs, lemons), grams for everything else. Nothing is stored in grams "under the hood" for piece ingredients. Nutrition values are per 100g, so nutrition is the one reader that converts: pieces × `gramsPerPiece` (falling back to 30g when that is null), via `componentGramsPerServing` in `src/lib/meal-planning/nutrition.ts` (HON-713).

An ingredient with `measuredByVolume` shows its quantity in millilitres, with 1 g = 1 ml, because import and the seeds store 1 ml as 1 g. The rule is display only: storage, nutrition, pantry deduction and shopping sums stay in grams. `displayUnit` in `src/lib/i18n/format-shopping-quantity.ts` chooses the unit for every screen, and `formatVolume` writes `<n>ml` below 1000 and `<n>l` from there on (HON-1054). The preparation-steps and cook-question prompts send the same unit, through `promptUnit` in `src/lib/ai/preparation-steps.ts`, so the steps say ml where the ingredient list does (HON-1070).

An ingredient with `pieceDisplay` shows its grams as pieces, so a cook reads "¾ pc" and a shopper buys "1 pc" (HON-1312). The rule is display only, as for millilitres. The recipe (cook view, sample weeks) divides by `gramsPerPiece`, rounds to the nearest quarter with ¼ as the minimum, and keeps the grams under the count: "¾ pc" and "83g". The shopping list sums the grams across meals and subtracts the pantry first, then rounds up to whole pieces, so three meals of ¼ onion buy 1 onion. `recipe_and_shopping` (onion, carrot, garlic cloves) applies both; `recipe` (potato, sold by weight) keeps grams on the list. The rule lives in `prisma/piece-display.ts`, which the seed reads; the formatters are in `src/lib/i18n/format-piece-quantity.ts`. Edit inputs, the pantry screen, the MCP tools and the AI prompts stay in grams. Without `gramsPerPiece` the ingredient shows in grams.

### Pantry Quantity Semantics

| State         | Meaning       | Shopping Result  |
| ------------- | ------------- | ---------------- |
| Not in pantry | Don't have it | Need full amount |
| `null`        | "Have some"   | Skip             |
| `0`           | "Ran out"     | Need full amount |
| `> 0`         | "Have X"      | Need difference  |

A staple skips the list for a planned meal, as long as the household has some. A staple at `0` ("ran out") goes on the list now, with or without a planned meal: with the planned amount when a meal or extra needs it, and with no amount when nothing does. Either way the line is a restock line (`restock: true`), needed today, tagged "Ran out" (HON-1398). An ordinary item at `0` goes on the list only when a planned meal or extra needs it.

---

## User Flows

### New User Setup

1. `/sign-up`: name, email, password, an invite code while `invite_code_required` is on, and the terms consent. Or Continue with Google, which needs only the invite code and the consent and passes the same gates; the address is verified already, and the new user lands on `/onboarding` (HON-1157). `/sign-in` has the same button, but it never creates an account. Email sign-up sends a verification email; the link works for 24 hours. The user can sign in before clicking it. My account → Profile (`/account`) shows the address as not verified, with Resend, until the link is opened (HON-1155). A password account changes its email on the same tab: a link goes to the new address, the change applies only when it is opened, and the old address then gets a notice that names support (HON-1137). The same tab lists the sign-in methods: Connect adds Google to a password account on the same address, Disconnect removes it while a password remains, and a Google-only account gets Set a password, which sends the reset email, in place of the change form (HON-1158)
2. `/onboarding` step 1 of 4: the welcome, and the household name
3. `/onboarding` step 2 of 4: who eats at the table, as Adults (the user first) and Children, each added with its own button; names are optional
4. `/onboarding` step 3 of 4: the allergens the household avoids, as the nine toggles and the AI notice of Household → Meal preferences (`AllergenPicker`); nothing ticked means none. Leaving this step creates the household, with its allergens in the same request
5. `/onboarding` step 4 of 4: the first plan, a start date and a number of days, then it generates and lands on `/`. The step says the first plan is dinners only and where to change that. A household that leaves before generating gets the same choices on `/` (`FirstTimeSetup`)

Allergens are asked in onboarding. The other preferences (dietary type, restrictions, excluded ingredients, meal types) are set on Household → Meal preferences (`/household/meal-preferences`) after onboarding. See "Onboarding" under Key Decisions.

### Planning

A household has one plan, and the Today page (`/`) shows it as a timeline from today through the next 14 days (`src/app/page.tsx`, `src/components/timeline/`). Past days have their own page, Past meals (`/past-meals`, `src/app/past-meals/page.tsx`): the last 7 days, newest first, and "Show the week before" adds 7 days per press, back to the week the household was created. Each past day lists its recipe and fridge meals as rows to mark cooked or skipped, and each expected meal type with no entry as a row with Add. Add logs what the household ate, a recipe or a fridge meal, saved as cooked with no pantry change and marked as already charged, so Undo then Cooked never charges the pantry for it (HON-1391); the recipe list puts the meals cooked most in the last 30 days first, and the fridge meal picker offers its free-text labels of the last 30 days as chips (HON-1383). A row that is not cooked also has Remove; a wrong log is fixed with Undo, then Remove. The account menu's dot counts only planned recipe meals of the last 7 days, never an empty slot.

1. First plan: `FirstTimeSetup` asks for a start date and a number of days (`getDaysCountOptions` in `src/lib/meal-planning/day-picker.ts`), then calls `POST /api/meal-plans/generate` with `mode: 'generate'`
2. Later: from the first upcoming day with nothing planned, `FillDaysAction` offers to fill a number of days, calling the same route with `mode: 'fill-empty'`. Only empty slots are filled (`src/lib/ai/fill-plan.ts`)
3. Review the days, optionally swap meals (see Meal Swap)
4. Day by day: mark meals completed or skipped
5. On completion: the pantry deducts the meal's ingredients once (`MealPlanEntry.pantryDeductedAt`). A meal logged on a past day, in the app or through the assistant, is saved with the marker set, so it is never charged
6. Any upcoming day: "+ Extra" adds a snack, a drink or another item outside the meals (see Pantry & Shopping List → Extras)

Generation takes any start date, and `endDate` is exclusive. There is no week boundary and no plan per week; see Meal Plan Rules.

### Shopping

1. Navigate to Shopping page
2. Rolling window list (7 or 14 days)
3. Group by category or urgency
4. Mark purchased → adds to pantry (`quantity = null`)
5. Remove from pantry → reappears on list

### Meal Swap

1. Click swap on an entry, or add on an empty slot; both open `MealSelectorModal`
2. See three ranked alternatives, or search the library and My recipes
3. Select replacement → entry updated

The alternatives make no model call. `/regenerate` (an entry with a meal) and `/suggestions` (an empty slot), under `src/app/api/meal-plans/[id]/entries/[entryId]/`, both through `suggestForSlot` (`src/lib/meal-planning/slot-suggestions.ts`, shared with the MCP `swap_meal` tool), query candidates from the database with the household's filters (dietary type, allergens, excluded ingredients, recent meals) and rank them with `scoreCandidate` (`src/lib/meal-planning/candidate-score.ts`) on favourites, the household's own recipes, kid-friendliness, pantry overlap and the household's net rating of the meal. `/regenerate` also rewards a protein type and prep time close to the meal being replaced (`SIMILARITY_WEIGHTS`); `/suggestions` has no meal to compare against (`SLOT_FIT_WEIGHTS`). They import only the cost-cap helpers from `@/lib/ai/usage`. Neither route restricts candidates to a protein type: generation places its required fish and legume dinners by position in a range that is not stored, so a swap cannot tell which slot was reserved. A swapped fish dinner still ranks fish alternatives first through `SIMILARITY_WEIGHTS`, and an empty slot has no protein preference at all (HON-892).

---

## Edge Cases & Gotchas

### Generation

- **Fewer than 5 dinner days**: Balance constraints are skipped (`MIN_DAYS_FOR_BALANCE` in `src/lib/meal-planning/slots.ts`)
- **Empty required pool**: 422 with code `insufficient_candidates`, naming the protein type in `message`. Nothing is written
- **Range too long**: 400 when the range exceeds `MAX_DAYS` (`src/app/api/meal-plans/generate/route.ts`)
- **Regenerate a range**: Deletes the range's `planned` and `skipped` entries and writes new ones. `completed` entries are kept and their slots are not regenerated, because the pantry was already charged for them (HON-650, `src/lib/ai/generate-plan.ts`)
- **Error codes**: every error body from the generate route carries a `code` (`src/lib/ai/error-codes.ts`); the client renders copy keyed on it

### Dates

- `endDate` is exclusive: a 7-day range starting 2026-10-01 has `endDate` 2026-10-08
- **"Today" uses household timezone**: Not server time (`getTodayInTimezone`, `src/lib/meal-planning/dates.ts`)

### Pantry

- **Mark purchased**: Creates item with `quantity = null` ("have some"), or sets an existing item to `null`
- **Auto-deduct on completion**: Not when the day passes
- **Past meals**: Excluded from shopping calculation

---

## Key Decisions

### AI Strategy

**Decision:** AI selects from a pre-filtered candidate list.

**Why:** Database handles hard constraints (allergens), AI handles variety. Makes AI a "selector" not "constraint enforcer."

**Implementation:**

- **Input:** Pre-filtered candidate meals (IDs + minimal metadata), capped per pool (`CANDIDATE_POOL_LIMIT` in `src/lib/ai/plan-candidates.ts`)
- **Output:** Structured output: `{ entries: [{ date, mealType, mealId }] }`
- **Failure:** A response that is still invalid after deterministic repair returns 422 `invalid_plan`; nothing is written. There is no automatic fallback to manual selection: the household retries, or adds meals slot by slot through Meal Swap
- **Tech:** Vercel AI SDK + Claude + Zod for structured output; the model is in `src/lib/ai/models.ts` (see [`docs/AI_MODELS.md`](./AI_MODELS.md))

| Concern                         | Handled by                              |
| ------------------------------- | --------------------------------------- |
| Allergens                       | Database query (hard filter)            |
| Excluded ingredients            | Database query (names, at read time)    |
| Recent history                  | Database query (`NO_REPEAT_DAYS`)       |
| Dietary type (e.g. vegetarian)  | Database query (excluded protein types) |
| Meal type match                 | Database query                          |
| Balance constraints (slots)     | Deterministic rules + DB query          |
| Notes for the AI (restrictions) | AI prompt only, not enforced            |
| Variety & balance               | AI selection                            |

**Important:** Allergens are safety-critical and DB-enforced. Restrictions, shown as "Notes for the AI" (e.g., "mild spice"), are free-form notes that the plan-generation, Imagine, Adjust recipe and cook-question prompts follow, including the MCP `adjust_meal` tool, which runs Adjust recipe. Swap, the empty-slot suggestions, the recipe list and the MCP tools `list_meals`, `plan_meal` and `swap_meal` do not read them, so nothing enforces them (HON-1326).

### Balance Constraints

**Decision:** Ensure variety via protein type slots (dinner only).

**Why:** Solves "no chicken 4 days in a row" and "fish or legumes in every plan of five or more dinners" without complex macro calculations.

**Implementation:**

Each meal has a `primaryProteinType` (derived from components):

```prisma
enum ProteinType {
  poultry    // chicken, turkey, duck
  beef
  pork
  lamb
  fish       // includes shellfish
  eggs
  legume     // beans, lentils, tofu, tempeh
  dairy      // cheese-dominant dishes
  none       // no significant protein
}
```

**Derivation logic:** See `deriveProteinType` in `src/lib/meal-planning/protein.ts`

**Main protein (household recipes):** the recipe form's "Main protein" select stores `Meal.proteinTypeOverride`, offered when the ingredients carry two or more protein types (HON-1386). A choice holds only while a non-vague ingredient carries that type; a write that leaves it unsupported clears it. `primaryProteinType` stays the effective value every reader uses: the choice, else the derived one (`resolveProteinType`). Library meals have no choice.

**Which slots:** `computeRequiredSlots` in `src/lib/meal-planning/slots.ts` places the required fish and legume dinners at relative positions in the range, by dietary type, and only when the range has at least `MIN_DAYS_FOR_BALANCE` dinner days. The count does not scale with the range: a 14-day range gets the same number of required slots as a 7-day one.

**Empty pool handling:** If a required slot's candidate pool is empty (due to allergens, exclusions, or recent history), generation stops with a 422 `insufficient_candidates` before the model is called (`src/lib/ai/generate-plan.ts`). It does not skip the slot.

**Why this works:**

- **80% of "balance" from one derived field** - no calorie math needed
- **DB-enforced slots** - a required fish dinner is a WHERE clause, not AI hope
- **Deterministic repair** - validation failures fixed without re-calling AI
- **Composable** - works with existing pre-filter architecture

### AI Generation Flow

`generateMealPlan` in `src/lib/ai/generate-plan.ts` (and `fillEmptySlots` in `src/lib/ai/fill-plan.ts`, for empty slots only):

1. Compute the slots in the range from the meal-type preferences, minus slots holding a `completed` entry
2. Compute required protein slots
3. Query candidate pools; stop with 422 if a required pool is empty
4. Cap and format the payload for the model
5. The model selects within the constraints. The call runs under `PLAN_AI_BUDGET_MS` (`src/lib/ai/budgets.ts`), one wall-clock budget shared by the first attempt and the AI SDK's retries; running out returns 504 `generation_timeout`
6. Hydrate the response, validate its structure, then validate the constraints and repair deterministically (`validateAndRepairPlan`, `src/lib/ai/plan-helpers.ts`). No second model call
7. In one transaction: find or create the household's plan, delete the range's replaceable entries, write the new ones

### Data Model

**Decision:** Ingredient-level planning with Meal-as-Template pattern.

**Why:** One "Chicken Rice Bowl" template works for any household size. Users have freedom in preparation method.

**Implementation:**

- **Meal** = Template (named combination of ingredients with per-serving quantities)
- **MealPlanEntry** = Instance (meal template assigned to a date, quantities calculated for household)
- **Shopping List** = Computed from MealPlanEntry minus pantry stock

**Units:** Each ingredient has a `defaultUnit` (g or piece). All quantities use this unit everywhere (see Quantity Units above). Liquids are stored in grams; `Ingredient.densityGPerMl` holds the conversion where it is known.

**Dates & Timezones:** Entry dates are calendar days; parse `YYYY-MM-DD` strings with `parseLocalDate` (`src/lib/meal-planning/dates.ts`), not `new Date(string)`. Each household has a `timezone` field (default Europe/Tallinn), and "today" is computed in it.

**Allergens vs Restrictions:**

- `allergens` = safety-critical, DB-enforced via `Allergen` enum
- `restrictions` = "Notes for the AI" in the UI ("mild spice") - free-form String\[\], read only by the AI prompts

**Food rules are household-level (HON-293, HON-296, HON-1322).** The diet, the allergens, the restrictions and the ingredients to avoid live on `HouseholdPreferences`, and every plan filter reads them there. A member carries a name, a display name and a portion size, and nothing else: the portion size scales the household's servings (`sumPortions`, `src/lib/meal-planning/servings.ts`). HON-1327 dropped the old member food and macro columns from `member_preferences`. An ingredient to avoid matches each row with the tag as whole words in its English or Estonian name, plural or singular (`matchTag`, `src/lib/household/excluded-ingredient-match.ts`). A tag that is a group word as a whole ("sausage", "cheese", "fish", "vorst") also excludes the rows its group lists, so "sausage" excludes frankfurter and chorizo (`INGREDIENT_GROUPS`, `src/lib/household/ingredient-groups.ts`, HON-1343).

**A preference change marks the plan, and never changes it by itself (HON-1126).** Meals planned before the change can break the new preferences. A planned card whose meal contains an avoided allergen, breaks the dietary type or uses an avoided ingredient carries one warning badge per constraint ("Contains: Tree nuts"), in the cook view too. Cooked and skipped meals are history and carry none. After a food-preference save on Household → Meal preferences, the toast says how many planned meals from today onward conflict. Nothing is swapped or removed: the household uses Swap on each marked card. The check is `findPreferenceConflicts` (`src/lib/meal-planning/preference-conflicts.ts`): the ingredients' `allergens` data first, then the `forbidden-foods` keyword lists for the meal name and the ingredients with no allergen data. Restrictions are free text and are not checked.

**Enums over strings:** Use Prisma enums for constrained values to prevent inconsistent data.

### Onboarding

**Decision:** Onboarding asks for the household's name, its members, and the allergens to avoid, and nothing else.

**Why:** It has to be quick. Decided 2026-09-29, for the name and the members only. Amended 2026-10-06 (HON-1082) to add the allergens: the first plan must not contain a meal the household is allergic to, and allergen filtering is the product's strongest claim. The step is optional: nothing ticked means no allergens, so a household with no allergy pays one tap.

**Consequence:** The first plan avoids the household's allergens and is otherwise generated with default preferences, because nothing has asked for any yet:

- Meal types: dinner only, on weekdays and on weekends. Household creation writes the preferences row with just these two set (`src/app/api/households/route.ts`).
- Dietary type: none, so no protein type is excluded. A plan with five or more dinners reserves one for fish and one for legumes, for variety (`src/lib/meal-planning/candidates.ts`, `src/lib/meal-planning/slots.ts`).
- Restrictions and excluded ingredients: none, so no meal is filtered out for them.

**Implementation:**

- Prompt to create household after sign-up
- Preferences are changed afterwards on Household → Meal preferences (`/household/meal-preferences`)
- Invite links are per member: the owner adds a member by name, then shares that member's link, and whoever signs in and opens it claims that member (`src/app/api/households/me/invites/route.ts`, `src/app/api/invites/[code]/join/route.ts`)

### Meal Scheduling

**Decision:** Weekday/weekend split for meal type configuration.

**Why:** Most families have different patterns on weekends.

**Implementation:**

- `weekdayMealTypes`: Which meals to plan Mon-Fri (default: dinner only)
- `weekendMealTypes`: Which meals to plan Sat-Sun (default: dinner only)

### Meal Plan Rules

**Decision:** One plan per household, holding entries over any dates. Replaced the earlier model of one plan per Monday-to-Sunday week on 2026-03-28 (HON-371, migration `20260328120000_continuous_meal_plan`).

**Why:** Weekly boundaries did not match how families actually plan meals (HON-371's commit message).

- **One plan:** `MealPlan` has `@@unique([householdId])` and no date columns (`prisma/schema.prisma`). The generate route finds or creates it
- **Dates live on entries:** `MealPlanEntry` has `@@unique([planId, date, mealType])`, so a slot holds at most one entry
- **Generation range:** `POST /api/meal-plans/generate` takes `startDate` and an exclusive `endDate`, any day of the week, up to `MAX_DAYS` days (`src/app/api/meal-plans/generate/route.ts`). Ranges may overlap earlier generations; regeneration replaces what it may (see Edge Cases)
- **Meal editing:** Ranked alternatives, or search the library and My recipes (see Meal Swap)
- **Leftover lunches (HON-1394):** a fridge meal's leftover item can point at an earlier recipe meal, planned or cooked, not skipped, up to 3 days before the fridge meal's own day. It carries `servings` (0.5 to 20, in steps of 0.5), required when the source is still planned. The source's **cook servings** are its own servings (`getEffectiveServings`) plus the servings of every leftover item from a fridge meal that is not skipped (`getCookServings`). The shopping list, the pantry's needed amounts, the pantry deduction and the AI prompts scale by cook servings; the servings control and `set_meal_servings` edit own servings only. Completion stores the cook servings (`MealPlanEntry.cookedServings`), so a lunch changed later leaves what the pantry was charged for. Cached tips priced at another total are regenerated on the next read. A swapped dinner keeps its lunches; a cleared dinner turns their items into free text. In the app (HON-1396), the fridge-meal picker lists the sources this rule allows for its slot (`loadLeftoverSources`), a planned one marked "planned" and started at the household's own servings, and each leftover item has a servings control; the entry routes run the same rule. A planned recipe dinner's ⋯ menu has "Cook for tomorrow's lunch too": a servings dialog, then one leftover item on the next day's lunch, which it plans as a fridge meal when empty or adds to when it is one (`addLeftoverLunch`). The action shows its reason and does not run when that lunch is a recipe meal, is cooked, or lunch is off for that day; it is hidden when that lunch already takes this dinner's leftovers

### Pantry & Shopping List

**Decision:** Computed shopping list from plan minus pantry.

**Why:** Pantry is persistent state; shopping list is derived. Simpler than syncing.

**Auto-deduction:** When marking a meal as completed, pantry quantities are automatically reduced.

**Rolling window:** Shopping list shows items needed for upcoming meals (not fixed to week boundaries).

**Purchased:** the pantry tracks two states for the list: have (`null`, "have some") and do not have (`0`, or no item). A quantity above 0 is a note the household keeps; the list subtracts it from the amount needed. Buying an item (the shopping list, or checking a linked custom item) puts it in the pantry as `null`, and replaces any quantity it held, a `0` or one the household entered. An item on the list is purchased only when its pantry quantity is `null` and the pantry item changed after the plan was created, so setting a quantity of 0 or more (the pantry page, the pantry API, `set_pantry_status` with `ran_out`) is never a purchase. Decided 2026-10-13, HON-1173, HON-1176. The household enters an amount on the pantry page (an On hand row's "Add amount", in the unit Wobblepot shows for the ingredient) or through `set_pantry_status` `amount`; a staple takes none, because completing a meal never takes a staple off. Decided 2026-10-28, HON-1402, which partly reverses HON-1201's "no amounts": the household now sees and changes the amount, so the list can trust it. Undo within 7 days deletes the pantry item; on a staple it keeps the item and sets it back to `0`, so the line comes back as a ran-out line (HON-1398).

**Extras.** A day's extras (`DayExtra`, HON-1309) are a list per household and date, not entries, so generation, "Regenerate a range" and "fill empty days" never touch them, and they need no slot, meal type or plan. An ingredient extra joins the rolling-window list for its day: one serving of its amount, merged with the meals' need for the same ingredient, under the same pantry rules. One with no amount is a vague line ("some"). A free-text extra adds nothing to the computed list; saving it puts its words on the list as a custom item and links the extra to it (HON-1310). Several extras can share one item. An item the household typed by hand is never linked, so Wobblepot never deletes it. Remove on the last linked extra deletes the item unless it is ticked off. In the urgency sort a linked item sits under the earliest linked day from today on; with none left it goes back to the custom items section and stays until ticked off. Why a link and not a computed free-text line: a merged line would cover several days, and every place that keys shopping lines by ingredient would change. An extra in the window counts as a plan for the empty state and for purchase dating. Extras have no Complete step, no pantry deduction and no nutrition, and a past extra shows nowhere. Why a day list and not a "Snack" meal type: a meal type touches generation, balance rules, swap ranking and meal-type preferences. Decided 2026-10-24.

**Default staples.** Every household starts with salt, black pepper and water marked as staples, with no quantity. They stay off the shopping list until someone marks them ran out (HON-1398). Removing one from the pantry puts it back on the shopping list when a meal needs it; unmarking it only turns it into an ordinary "have some" item, which the list also skips. Decided 2026-09-24, HON-769. Vague quantities ('to taste', 'a handful') stay on the list: they are real purchases for most ingredients, and the staple flag is what keeps seasonings off it.

### Household Invites

**Decision:** Single-use links, one per household member. Replaced the multi-use household link on 2026-01-16 (HON-114, migration `20260116100000_member_specific_invites`). `maxUses` and `usesCount` are left over from it; no code in `src` reads them.

**Why:** Members and invites were two separate concepts. Making the invite a way to claim an existing member profile merged them into one member-first flow: the owner creates the member, then optionally shares a link (HON-114's commit message). Links rather than email: simple, no email required, suitable for family sharing. Email-based invites remain out of scope.

**Implementation:**

- The owner adds a member by name, then creates that member's link (`src/app/api/households/me/invites/route.ts`). Only a member without an account can get one. `HouseholdInvite.memberId` is `@unique`, so creating a link again replaces the member's code and expiry. Expiry is set per request (`expiresInDays` in the route's schema, with its default)
- Joining (`src/app/api/invites/[code]/join/route.ts`) claims the member row for the signed-in user and deletes the invite in the same transaction. Two people opening the same link race safely: the loser gets `invite_invalid` (400) or `invite_not_found` (404), and the client shows the same message for both. A unique index on `household_member."userId"` keeps a user out of a second household (HON-696); the route's doc comments describe the locking
- Leaving (`POST /api/households/me/leave`, `src/lib/household-leave.ts`, HON-1133): a `member` leaves freely and the household keeps its data. An owner who is the only account holder leaves by deleting the household, with everything in it; members without an account do not count. An owner with other account holders cannot leave until they remove them; there is no ownership transfer
- An invitee who already has a household gets "Leave and join" on the invite page. The join route takes `{ leaveCurrent: true }` and runs the leave and the claim in one transaction, so a failed claim keeps the old household

### Children's Data (Art. 8)

**Decision:** No in-app parental-consent capture — no under-16 flag, no consent timestamp, no acknowledgment checkbox. Art. 8 is not an open launch gate.

**Why:** Art. 8 governs a child's _own_ consent to an information society service offered directly to them. Wobblepot has no child accounts: a household member profile is created and managed by the account-holding parent or guardian, who is the one consenting. A checkbox shown to that same parent adds evidentiary ceremony, not a missing legal basis. The substantive control is the Art. 9 health-data position on allergen and dietary data, which applies to every member — adults included — and rests on the privacy policy's AI-processing disclosure rather than on an under-16 toggle. [`compliance/dpia.md`](../compliance/dpia.md) originally rated "Art. 9 basis challenged" as its only Medium residual risk and recommended a one-line allergen-entry affirmation — for all members, not only under-16s — before public launch. That shipped in HON-666 as a notice under the household allergen checkboxes, which drops the residual to Low; it did not reopen the Art. 8 decision here.

**Where this is recorded:**

- Privacy policy → "Children's data" (`src/app/(legal)/privacy/page.tsx`) — accounts are for people aged 16 or over across all EU/UK jurisdictions, and adding a member under 16 is the parent or guardian confirming they consent on the child's behalf. Read the live wording there rather than a copy here; `page.test.tsx` pins only the "aged 16 or over" and "parent or legal guardian" substrings, not the whole sentence.
- [`compliance/dpia.md`](../compliance/dpia.md) → Risk area 1 — reviewed this position and concurs. Also records the data-minimisation posture: no DOB, no photos, not even an under-16 flag is stored.
- HON-467 (Canceled 2026-06-06) carries the original decision on its comment thread.

**Revisit if:** standalone child accounts ever ship — Art. 8 then applies for real — or AKI/EDPB guidance moves on children's data.

### Error Handling

**AI Failures:** the numbers live in code; read them there rather than copying them here.

- **Timeouts:** each AI route has a wall-clock budget in `src/lib/ai/budgets.ts`, sized under the route's `maxDuration`, and shared by the first attempt and the AI SDK's retries. Running out returns a 504 the client renders as catalog copy. The exception is the meal-image route, whose `AI_BUDGET_MS` is in `src/lib/meal-images/start.ts`
- **Retries:** the AI SDK's own retries, bounded by that budget. Meal images are the exception: `src/lib/meal-images/generate.ts` runs its own retry loop. No route makes a second model call to repair a bad plan; repair is deterministic (see AI Generation Flow)
- **Rate limits:** per household or per user, per feature, in `src/lib/rate-limit.ts` (Upstash Redis). A limited request gets 429 with `Retry-After`. The limiter fails open when Redis is unreachable (see `checkRateLimit`)
- **Cost cap:** every AI route, and the two swap routes, calls `assertUnderCap` (`src/lib/ai/usage.ts`) against the household's `aiCapUsd`
- **Kill-switch:** `ai_generation_enabled` returns 503 from plan generation (see [`docs/FEATURE_FLAGS.md`](./FEATURE_FLAGS.md))
- **No fallback flow:** a failed generation shows an error and the household can generate again, or fill slots one at a time through Meal Swap

### Scope Boundaries

**In scope for MLP:**

- Meals as ingredient combinations with per-serving quantities; a household's own recipes can also carry free-text preparation notes
- Meal planning over a chosen date range (see Meal Plan Rules), with preferences
- Weekday/weekend meal type scheduling
- Shopping list generation (computed, rolling window)
- Pantry tracking with auto-deduction
- Mobile-responsive web
- Single-use member invite links
- Progress animation for AI generation
- Nutrition disclaimers
- DB-enforced allergen filtering
- Balance constraints via protein type slots
- Today dashboard as default home
- Manual household members (for kids, etc.)
- Account deletion and data export
- Meal ratings (thumbs up or down on an entry), which feed the swap ranking; plan generation does not read them
- Favourite meals
- Own recipes: create, import from a URL or pasted text, or describe one for the AI to write (`/recipes`)
- Add a missing ingredient from an unmatched ingredient row: household-scoped, with allergens, protein type and nutrition per 100 g from the pack label (`POST /api/ingredients`, HON-1263)
- AI preparation tips for a planned meal
- MCP server for AI assistants such as Claude (`/api/mcp`): reads the meal plan, shopping list, pantry and meals, and the household's rules, members and servings (`get_household`); with the user's `mcp:write` permission, marks items purchased, adds or checks shopping list items, sets pantry quantities, swaps a planned meal, plans a chosen meal in an empty slot (`plan_meal`, no 14-day repeat rule), or logs a past meal the household ate as cooked, with no pantry change (`plan_meal`, `plan_fridge_meal`, `swap_meal`), changes a planned meal's ingredients from an instruction through Adjust recipe (`adjust_meal`, the one tool that calls the AI, under the household's cost cap), or replaces, leaves out, adds or restores the ingredients the user names, all or none, with no AI (`change_meal_ingredients`), marks a planned meal cooked, skipped or planned again, which takes a cooked meal's ingredients out of the pantry (`set_meal_status`), rates a cooked one, clears a meal that is not cooked (`clear_meal`), changes a planned meal's servings, which the shopping list follows (`set_meal_servings`), adds or removes a day's extras and changes an extra's amount (`add_extra`, `remove_extra`, `set_extra_amount`), removes a hand-added shopping list item (`remove_shopping_item`), adds or removes a favourite meal (`set_favourite`), saves a household recipe whose ingredient names all match with confidence (`create_meal`), changes one (`update_meal`), and deletes one, which the household or the assistant can restore for 30 days (`delete_meal`, `restore_meal`) (HON-1151, HON-1154, HON-1173, HON-1174, HON-1246, HON-1305, HON-1306, HON-1311, HON-1314, HON-1323, HON-1329, HON-1330, HON-1331, HON-1332, HON-1333, HON-1334, HON-1337, HON-1382)

**Out of scope:**

- Conversational refinement
- Offline support (there is a web manifest but no service worker)
- Monetization/subscriptions
- Multi-household switcher
- Email-based invites
- Plan history beyond Past meals: no search, export or statistics over past entries. Past meals reaches back a week at a time to the household's first week (HON-1383)
- Real-time multi-user sync
- Other MCP tools that call the AI (plan generation, imagining a meal). The household's AI cost cap is the budget they would run under, as `adjust_meal` does (HON-1246). MCP tools that change members or preferences

---

## Technical Reference

_For the tech stack, see [CLAUDE.md](../CLAUDE.md); exact versions are pinned in `package.json`. This section covers domain-specific technical details._

### Environment Variables

**Source of truth:** `src/lib/env.ts` (the Zod schemas; public vars are validated at load, server-only vars on first access). What each one is for and where to get it: [`docs/ENVIRONMENT_SETUP.md`](./ENVIRONMENT_SETUP.md).

### Constants

Domain constants live beside the code that uses them. The ones a reader is most likely to need:

- `NO_REPEAT_DAYS`: how long a meal stays out of generation after it was planned (`src/lib/meal-planning/candidates.ts`)
- `CANDIDATE_POOL_LIMIT`: candidates per pool sent to the model (`src/lib/ai/plan-candidates.ts`)
- `MIN_DAYS_FOR_BALANCE`: dinner days needed before protein slots apply (`src/lib/meal-planning/slots.ts`)
- `MAX_DAYS`: the longest generation range (`src/app/api/meal-plans/generate/route.ts`)
- AI budgets: `src/lib/ai/budgets.ts`. Rate limits: `RATE_LIMIT_CONFIG` in `src/lib/rate-limit.ts`

### Database Schema

**Source of truth:** `prisma/schema.prisma`

The main areas:

- **Auth:** the Better Auth models (`User`, `Session`, `Account`, `Verification`) and `SignupCode` for invite-only sign-up
- **Households:** `Household`, `HouseholdMember`, `HouseholdPreferences` (the food rules), `MemberPreferences` (display name and portion size), and `HouseholdInvite` (single-use, per member)
- **Meals:** `Ingredient`, `Meal`, `MealComponent`, `FavoriteMeal`, plus `IngredientTranslation` and `MealTranslation` for Estonian
- **Planning:** `MealPlan` (one per household) and `MealPlanEntry` (one per date and meal type)
- **Inventory:** `PantryItem` and `CustomShoppingItem`
- **AI accounting:** `AiUsage`, read by the per-household cost cap

### API Routes

**Source of truth:** `src/app/api/**/route.ts`. Each route's doc comment describes its contract.

The main areas: `auth` (Better Auth, plus account deletion and export under `auth/user`), `households` (the current household under `households/me`: members, invites, preferences, own meals, AI usage), `invites` (joining), `meals` and `ingredients` (library, favourites, imagine, meal images), `recipes` (parse a recipe), `meal-plans` (generate; entries, swaps, preparation tips, per-plan shopping list), `entries` (entries by date range), `shopping-list`, and `pantry`. Operational routes: `health`, `status`, `cron`, `admin`, and the E2E-only `e2e-seed` / `e2e-support`.

### Frontend Pages

**Source of truth:** `src/app/**/page.tsx`. The page map, including which routes are redirect stubs, is in [`docs/BROWSER_TESTING.md` → Page map](./BROWSER_TESTING.md#page-map). Which routes need a session is decided in `src/proxy.ts` (`PROTECTED_PREFIXES`, `PUBLIC_ROUTES`).

---

## What's Built

### Foundation (Complete)

- Household creation on sign-up (via onboarding)
- Household preferences CRUD, and a member's display name and portion size
- Household invite links (create, join, manage)
- Manual household members (for non-app users like kids)
- Settings UI (household, member, invites)
- Auth with password reset via email
- E2E and unit test suites
- Accessibility improvements
- Loading skeletons, toast notifications

### Core Planning (Complete)

- AI meal plan generation over a chosen date range, with slot-based balance
- Filling empty days without regenerating planned ones
- Plan validation and repair logic
- Today timeline: the past 7 days and the next 14
- Meal detail view with nutrition and AI preparation tips
- Meal swap via ranked alternatives or library search
- Meal ratings and favourites
- Progress animation for generation
- A seeded global meal library (`prisma/seed*.ts`), with Estonian translations

### Recipes (Complete)

- My recipes: create, edit, and import from a URL or pasted text (`/recipes`)
- Imagine: describe what you want, optionally with photos, and the AI suggests recipes to save (`/recipes/imagine`)
- Generated meal images. A household recipe's image starts when it is saved, or edited in a way that clears its image: the save request claims it and `after()` draws it, so saving is not slower. The My recipes card shows a plain `bg-muted` box until it is ready (HON-1364). A recipe saved another way (MCP, a plan entry made a recipe) still gets its image when its cook view first opens.
- Delete and restore (HON-1336): Delete sets `Meal.deletedAt` and keeps the image. For 30 days, the same window as account deletion, the household can bring the recipe back with its image, ingredients and history: Undo in the delete toast, or Restore under "Recently deleted" at the end of `/recipes` (`src/lib/deleted-household-meals.ts`, `POST /api/households/me/meals/[id]/restore`). After 30 days the recipe cannot be restored, and the daily purge cron clears its image and deletes the file (`purgeExpiredDeletedMealImages`). The `Meal` row stays, because past plan entries and `get_meal` read it.

### Shopping & Pantry (Complete)

- Shopping list computation (rolling window)
- Urgency sorting with group headers
- Pantry management with ingredient search
- Auto-deduct pantry on meal completion
- Mark purchased to move an item into the pantry, and undo it
- Custom shopping items
- Day extras (snacks, drinks) on the timeline and the shopping list
- Missing ingredients indicators on meals

### AI assistants (Ongoing)

- MCP server at `/api/mcp` (HON-1151): an assistant such as Claude reads the household's meal plan, shopping list, pantry, meals and settings through OAuth (HON-1150, HON-1323). See [MCP_SERVER.md](./MCP_SERVER.md)
- MCP write scope `mcp:write` (HON-1154): the assistant marks shopping list items purchased, adds items and checks them off, if the user allowed it on `/consent`. The same scope sets a pantry quantity (HON-1173); `ran_out` on a staple puts it on the shopping list, and the list marks such a line `restock` (HON-1398). The same scope swaps a planned meal and rates a cooked one (HON-1174). A swap through the assistant accepts any meal that suits the meal type and fits the household's diet, allergens and avoided ingredients, a recent one too, and says when the meal was last planned (HON-1392). The same scope changes a planned meal's ingredients from an instruction (`adjust_meal`, HON-1246): the app's Adjust recipe without the review dialog, applying only the replacements the catalogue matched, under the `adjust-recipe` limit and the household's AI cost cap. The same scope replaces, leaves out, adds or restores the ingredients the user names, with no AI (`change_meal_ingredients`, HON-1385): nothing is written unless every name resolves and every replacement matches with confidence, so a half-applied change never reaches the shopping list. The same scope saves a household recipe (`create_meal`, HON-1305): the server matches each ingredient name and writes nothing unless every name matches with confidence and the household has no recipe of that name. The same scope changes a household recipe (`update_meal`, HON-1314): a field left out keeps its value, a new ingredient list replaces the old one and is matched the same way, and a shared recipe is refused. Both tools set the recipe's main protein, as the recipe form does (`mainProtein`, HON-1387): a choice no ingredient carries writes nothing and returns the recipe's protein types (`check_protein`), and `update_meal` with `null` goes back to automatic. The same scope plans a chosen meal in an empty slot (`plan_meal`, HON-1306): the meal must suit the meal type and fit the household's diet, allergens and avoided ingredients, and the day must be no more than 28 days ahead; the 14-day no-repeat rule of the suggestions does not apply. A past day logs a meal the household ate (HON-1382): `plan_meal`, `plan_fridge_meal` and `swap_meal` save the meal as cooked, with no lower limit on the date and no pantry change, and a cooked slot is still refused. On a past slot, `swap_meal` checks the meal as `plan_meal` does, not against the swap ranking, so a repeat is logged. The same scope adds and removes a day's extras (`add_extra`, `remove_extra`, HON-1311): the server matches the name, and a name without a sure match is saved as free text only when it has no amount, and a matched name whose amount crosses between pieces and weight by a guess or to a total the matcher flags saves nothing and asks for a check (`check_quantity`). The same scope changes an ingredient extra's amount in place, or clears it (`set_extra_amount`, HON-1334): the amount must come in the unit Wobblepot shows for the extra, because the tool does not convert, and a free-text extra is refused. The same scope clears a planned or skipped meal or a fridge meal that is not cooked (`clear_meal`, HON-1329): a cooked meal is refused, as the app offers Clear only on a card that is not cooked. The same scope marks a planned meal cooked, skipped or planned again (`set_meal_status`, HON-1330): `cooked` takes a recipe meal's ingredients out of the pantry, or sets the fridge meal's named pantry items to zero, at most once per meal, and going back to planned does not restock the pantry. The same scope sets how many servings a planned recipe meal is cooked for, 1 to 20, or puts it back on the household default (`set_meal_servings`, HON-1331): the shopping list follows the new count, and a cooked meal or a fridge meal is refused. The same scope removes an item the household added to the shopping list by hand (`remove_shopping_item`, HON-1332): an item from planned meals follows the plan and cannot be removed, and a free-text extra whose item is removed stays on its day. The same scope adds or removes a favourite meal (`set_favourite`, HON-1333): the meal must be one the household can see, and a meal that already has the asked-for state is left as it is. The same scope deletes one of the household's own recipes and restores it (`delete_meal`, `restore_meal`, HON-1337): a delete is the app's soft delete, so the recipe shows in "Recently deleted" and either path restores it for 30 days; meals planned with it stay on the plan

### Polish & UX (Ongoing)

- Today dashboard as homepage
- Streamlined navigation
- Simplified meal statuses (planned/completed/skipped)
- Badge and indicator refinements
- Mobile-responsive throughout

---

## Success Criteria

### Product quality (gates on "does it work")

- [ ] Use for 2+ weeks of meal planning
- [ ] Generate useful, balanced meal suggestions
- [ ] Accurate shopping lists
- [ ] Mobile interface we actually want to use
- [ ] Saves time vs manual planning

### Launch readiness (gates on "can we take EU sign-ups")

- [ ] Legal: Privacy Policy + Terms published and versioned consent captured at sign-up (HON-457); DPAs in place with Anthropic, Resend, Vercel, PostHog and Neon (HON-459, HON-553, [`compliance/README.md`](../compliance/README.md)); the DPIA's allergen-entry affirmation (HON-666, [Risk area 2](../compliance/dpia.md))
- [x] GDPR user rights: data export (Art. 20) and 30-day grace-window deletion (Art. 17) shipped; children's data needs no separate Art. 8 consent capture — see [Key Decisions → Children's Data](#childrens-data-art-8)
- [ ] Observability: PostHog installed behind cookie consent (HON-474, HON-462, HON-525); errors captured with alerts (HON-452, HON-526); core-funnel events instrumented in `src/lib/analytics.ts` (HON-476); core funnels saved in production PostHog on the dashboard "GTM: beta cohort", as the insights "GTM: activation funnel" and "GTM: weekly planning retention" (HON-1075). Both count only people who accepted analytics cookies. **Open:** web vitals (unverified from repo: capture is a PostHog project setting, HON-460, and the production Web Vitals view has not been confirmed)
- [x] Abuse protection: durable rate limits (Upstash Redis) on auth (HON-463) and generation + the other AI routes (HON-451); AI per-household cost cap via `assertUnderCap` (HON-453). The limiter fails open when Redis is unreachable, a deliberate trade-off — see the `checkRateLimit` doc comment in `src/lib/rate-limit.ts`; `/status` shows the outage via `probeRateLimit`
- [x] Email: sending domain, FROM addresses and setup documented in [`docs/EMAIL_SETUP.md`](./EMAIL_SETUP.md) (HON-465). Verified on production on 2026-10-07 (HON-1081): SPF, DKIM and DMARC all `pass` and aligned in the `Authentication-Results` of a received message; the password reset landed in the inbox at Gmail and Outlook.com, and the waitlist confirmation and the invite code in the inbox at Outlook.com; Mail-Tester scored 10/10 on the waitlist confirmation. iCloud was not tested. The results are on HON-1081. DMARC stays at `p=none` until HON-480 escalates it
- [x] CI safety net: E2E re-enabled in CI (HON-455, HON-518); tier 1 covers sign-up (`auth.spec.ts`), shopping→pantry (HON-479) and the household member-invite flow (`household-invite.spec.ts`, HON-667 — replaces the stale `invite.spec.ts` HON-518 deleted). Meal-plan generation is deliberately **not** gated by CI: the `@ai` specs call Claude for real, so instead of being mocked or scheduled they run as a manual pre-promotion step — `pnpm test:e2e:local --ai`, step 3 of [`docs/DEPLOYMENT.md`](./DEPLOYMENT.md) § Production Deployment Process (HON-667 settled this and added that step; see also [`tests/e2e/README.md`](../tests/e2e/README.md) → "Why the `@ai` split")
- [ ] Launch hygiene: `/api/health` (HON-454); `not-found.tsx`, `robots.ts`, `sitemap.ts` and OG/Twitter metadata (HON-456; legal routes added to the sitemap in HON-559); the OG card is generated in code by `src/app/opengraph-image.tsx` (HON-483 — it replaced the `/og-image.png` the metadata used to reference, which never existed). **Open:** uptime monitor (HON-484)

---

## Future Considerations

_Ideas for later. Some may be pulled into MLP iteration if they feel essential. What has shipped is under What's Built, not here._

- Expiry tracking & "use soon" suggestions (`PantryItem.expiresAt` exists, but no UI sets it and no feature uses it)
- Calorie-aware meal planning
- Kid-friendly filtering in AI validation
- Cooking time optimization
- Ratings as a signal in plan generation (today only the swap ranking reads them)
- Offline support
- Multi-household support
- Email-based invites
- Plan history beyond Past meals' week-at-a-time list (search, export, statistics)
- Real-time multi-user sync
- Restriction templates (auto-expand "nut allergy" → specific nuts)
- Configurable time budget per household
- Meal tags for flexible categorization
- isLeftoversFriendly meal flag
- Per-day meal type configuration
- Balance rules for lunch (currently dinner-only)
- In-shop mode for shopping list (simplified UI, larger touch targets)
