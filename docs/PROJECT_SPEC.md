# Wobblepot: AI-Powered Family Meal Planning

> **Naming note:** **Wobblepot** (pronounced "WOB-bul-pot") is the user-facing product brand. _Honkadori OÜ_ is the parent legal entity — used for vendor accounts (PostHog org, Neon org, etc.), DPAs, subprocessor listings, AKI registration. All user-facing copy and email lives on `wobblepot.com`; staging is on `wobblepot.dev`. Legal-entity attribution (Honkadori OÜ) appears in policy text, not in the email address. Brand decision recorded in HON-539; in-code brand swap completed in HON-538; staging migration completed in HON-542.

## Current Status

**Mode:** Launch readiness for public EU beta — first cohort by invitation only.

Foundation and core flows are complete (AI planning, shopping, pantry, auth, household management). Open work is the launch-readiness band: GDPR/legal, production observability, abuse protection, email deliverability, and launch hygiene (metadata, uptime). Target launch geography is EU-wide including UK-GDPR — the compliance bar is the full GDPR surface, not "soft launch to friends". First real-world user is still a family of 4 (two young children); the bar is set at public-beta because retrofitting compliance later is worse than paying the cost upfront.

Sign-up is gated behind single-use invite codes (HON-488) controlled by the `invite_code_required` PostHog kill-switch (default `true`). Flipping the flag to `false` opens public sign-up without a deploy; flipping back re-locks. This shrinks blast radius for the first cohort while keeping us one toggle away from open beta. A visitor without a code can join the waitlist at `/request-invite` and confirm by an emailed link (HON-846); the admin picks who to invite (HON-970).

---

## Vision

### Problem

- Daily "what's for dinner" decision fatigue
- Grocery management (lists, forgotten items, multiple trips)
- Nutrition balance for families with dietary/macro preferences
- Time constraints (45-60 min cooking window)
- Kid-friendly meal considerations

### Target Users

Target audience for public EU beta: families with young children across EU/EEA and UK. Initial real-world user: family of 4 (two young children). The first cohort joins by invitation only — admin mints `SignupCode` rows at `/admin/signup-codes` and shares them out-of-band; signups without a code return 403 while `invite_code_required` is `true`.

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

| Term                | Definition                                                                                           |
| ------------------- | ---------------------------------------------------------------------------------------------------- |
| **Plan**            | The household's single `MealPlan`. It has no dates of its own; its entries cover any days.           |
| **Meal**            | Template: ingredient combination with per-serving quantities. Reusable across days.                  |
| **Recipe**          | User-facing name for a household's own Meal in My recipes. Meal stays the model name.                |
| **Entry**           | Instance: meal assigned to a date + mealType with status (planned/completed/skipped).                |
| **Slot**            | A date + mealType position.                                                                          |
| **SlotRequirement** | Slot with required protein type (dinner-only, for balance).                                          |
| **Component**       | Meal-to-ingredient link with `quantityPerServing`, in the ingredient's `defaultUnit`.                |
| **Candidate**       | Meal that passed the hard filters: eligible for AI selection in generation, and for swap ranking.    |
| **Pool**            | Candidates filtered by protein type (fish, legume, any).                                             |
| **Staple**          | Pantry item always assumed in stock; never on shopping list.                                         |
| **Rolling window**  | Shopping aggregation: today through 7 or 14 days ahead (`src/app/shopping/load-inventory.ts`).       |
| **Urgency bucket**  | Shopping grouping: today / tomorrow / this-week / later (`getUrgencyBucket`, `meal-planning/dates`). |

### Quantity Units

`MealComponent.quantityPerServing`, pantry stock, and shopping quantities all use the ingredient's `defaultUnit`: a piece count for a `piece` ingredient (eggs, lemons), grams for everything else. Nothing is stored in grams "under the hood" for piece ingredients. Nutrition values are per 100g, so nutrition is the one reader that converts: pieces × `gramsPerPiece` (falling back to 30g when that is null), via `componentGramsPerServing` in `src/lib/meal-planning/nutrition.ts` (HON-713).

An ingredient with `measuredByVolume` shows its quantity in millilitres, with 1 g = 1 ml, because import and the seeds store 1 ml as 1 g. The rule is display only: storage, nutrition, pantry deduction and shopping sums stay in grams. `displayUnit` in `src/lib/i18n/format-shopping-quantity.ts` chooses the unit for every screen, and `formatVolume` writes `<n>ml` below 1000 and `<n>l` from there on (HON-1054). The preparation-steps and cook-question prompts send the same unit, through `promptUnit` in `src/lib/ai/preparation-steps.ts`, so the steps say ml where the ingredient list does (HON-1070).

### Pantry Quantity Semantics

| State         | Meaning       | Shopping Result  |
| ------------- | ------------- | ---------------- |
| Not in pantry | Don't have it | Need full amount |
| `null`        | "Have some"   | Skip             |
| `0`           | "Ran out"     | Need full amount |
| `> 0`         | "Have X"      | Need difference  |

---

## User Flows

### New User Setup

1. `/sign-up`: name, email, password, an invite code while `invite_code_required` is on, and the terms consent
2. `/onboarding` step 1 of 4: the welcome, and the household name
3. `/onboarding` step 2 of 4: who eats at the table, as Adults (the user first) and Children, each added with its own button; names are optional
4. `/onboarding` step 3 of 4: the allergens the household avoids, as the nine toggles and the AI notice of `/household` (`AllergenPicker`); nothing ticked means none. Leaving this step creates the household, with its allergens in the same request
5. `/onboarding` step 4 of 4: the first plan, a start date and a number of days, then it generates and lands on `/`. The step says the first plan is dinners only and where to change that. A household that leaves before generating gets the same choices on `/` (`FirstTimeSetup`)

Allergens are asked in onboarding. The other preferences (dietary type, restrictions, excluded ingredients, meal types) are set on `/household` after onboarding. See "Onboarding" under Key Decisions.

### Planning

A household has one plan, and the Today page (`/`) shows it as a timeline: the past 7 days, collapsed above today, and the next 14 days (`src/app/page.tsx`, `src/components/timeline/`).

1. First plan: `FirstTimeSetup` asks for a start date and a number of days (`getDaysCountOptions` in `src/lib/meal-planning/day-picker.ts`), then calls `POST /api/meal-plans/generate` with `mode: 'generate'`
2. Later: from the first upcoming day with nothing planned, `FillDaysAction` offers to fill a number of days, calling the same route with `mode: 'fill-empty'`. Only empty slots are filled (`src/lib/ai/fill-plan.ts`)
3. Review the days, optionally swap meals (see Meal Swap)
4. Day by day: mark meals completed or skipped
5. On completion: the pantry deducts the meal's ingredients once (`MealPlanEntry.pantryDeductedAt`)

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

The alternatives make no model call. `/regenerate` (an entry with a meal) and `/suggestions` (an empty slot), under `src/app/api/meal-plans/[id]/entries/[entryId]/`, query candidates from the database with the household's filters (dietary type, allergens, excluded ingredients, recent meals) and rank them with `scoreCandidate` (`src/lib/meal-planning/candidate-score.ts`) on favourites, the household's own recipes, kid-friendliness, pantry overlap and the household's net rating of the meal. `/regenerate` also rewards a protein type and prep time close to the meal being replaced (`SIMILARITY_WEIGHTS`); `/suggestions` has no meal to compare against (`SLOT_FIT_WEIGHTS`). They import only the cost-cap helpers from `@/lib/ai/usage`. Neither route restricts candidates to a protein type: generation places its required fish and legume dinners by position in a range that is not stored, so a swap cannot tell which slot was reserved. A swapped fish dinner still ranks fish alternatives first through `SIMILARITY_WEIGHTS`, and an empty slot has no protein preference at all (HON-892).

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

- **Mark purchased**: Creates item with `quantity = null` ("have some")
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
| Excluded ingredients            | Database query                          |
| Recent history                  | Database query (`NO_REPEAT_DAYS`)       |
| Dietary type (e.g. vegetarian)  | Database query (excluded protein types) |
| Meal type match                 | Database query                          |
| Balance constraints (slots)     | Deterministic rules + DB query          |
| Dietary concepts (restrictions) | AI guidance (best effort, not enforced) |
| Variety & balance               | AI selection                            |

**Important:** Allergens are safety-critical and DB-enforced. Restrictions (e.g., "low FODMAP", "keto-ish") are free-form guidance for the AI with no guarantee of enforcement.

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
- `restrictions` = dietary concepts ("low FODMAP") - free-form String\[\], AI interprets with best-effort

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
- Preferences are changed afterwards on `/household`
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

### Pantry & Shopping List

**Decision:** Computed shopping list from plan minus pantry.

**Why:** Pantry is persistent state; shopping list is derived. Simpler than syncing.

**Auto-deduction:** When marking a meal as completed, pantry quantities are automatically reduced.

**Rolling window:** Shopping list shows items needed for upcoming meals (not fixed to week boundaries).

**Default staples.** Every household starts with salt, black pepper and water marked as staples, with no quantity. Removing one from the pantry puts it back on the shopping list; unmarking it only turns it into an ordinary "have some" item, which the list also skips. Decided 2026-09-24, HON-769. Vague quantities ('to taste', 'a handful') stay on the list: they are real purchases for most ingredients, and the staple flag is what keeps seasonings off it.

### Household Invites

**Decision:** Single-use links, one per household member. Replaced the multi-use household link on 2026-01-16 (HON-114, migration `20260116100000_member_specific_invites`). `maxUses` and `usesCount` are left over from it; no code in `src` reads them.

**Why:** Members and invites were two separate concepts. Making the invite a way to claim an existing member profile merged them into one member-first flow: the owner creates the member, then optionally shares a link (HON-114's commit message). Links rather than email: simple, no email required, suitable for family sharing. Email-based invites remain out of scope.

**Implementation:**

- The owner adds a member by name, then creates that member's link (`src/app/api/households/me/invites/route.ts`). Only a member without an account can get one. `HouseholdInvite.memberId` is `@unique`, so creating a link again replaces the member's code and expiry. Expiry is set per request (`expiresInDays` in the route's schema, with its default)
- Joining (`src/app/api/invites/[code]/join/route.ts`) claims the member row for the signed-in user and deletes the invite in the same transaction. Two people opening the same link race safely: the loser gets `invite_invalid` (400) or `invite_not_found` (404), and the client shows the same message for both. A unique index on `household_member."userId"` keeps a user out of a second household (HON-696); the route's doc comments describe the locking

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

- **Timeouts:** each AI route has a wall-clock budget in `src/lib/ai/budgets.ts`, sized under the route's `maxDuration`, and shared by the first attempt and the AI SDK's retries. Running out returns a 504 the client renders as catalog copy. The exception is the meal-image route, whose `AI_BUDGET_MS` is in `src/app/api/meals/[id]/image/route.ts`
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
- AI preparation tips for a planned meal

**Out of scope:**

- Conversational refinement
- Offline support (there is a web manifest but no service worker)
- Monetization/subscriptions
- Multi-household switcher
- Email-based invites
- Plan history/archive: the Today timeline shows only the last 7 days
- Real-time multi-user sync

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
- **Households:** `Household`, `HouseholdMember`, `HouseholdPreferences`, `MemberPreferences`, and `HouseholdInvite` (single-use, per member)
- **Meals:** `Ingredient`, `Meal`, `MealComponent`, `FavoriteMeal`, plus `IngredientTranslation` and `MealTranslation` for Estonian
- **Planning:** `MealPlan` (one per household) and `MealPlanEntry` (one per date and meal type)
- **Inventory:** `PantryItem` and `CustomShoppingItem`
- **AI accounting:** `AiUsage`, read by the per-household cost cap

### API Routes

**Source of truth:** `src/app/api/**/route.ts`. Each route's doc comment describes its contract.

The main areas: `auth` (Better Auth, plus account deletion and export under `auth/user`), `households` (the current household under `households/me`: members, invites, preferences, own meals, AI usage), `invites` (joining), `meals` and `ingredients` (library, favourites, imagine, meal images), `recipes` (parse a recipe), `meal-plans` (generate; entries, swaps, preparation tips, per-plan shopping list), `entries` (entries by date range), `shopping-list`, `pantry`, and `members` (the signed-in member's own preferences). Operational routes: `health`, `status`, `cron`, `admin`, and the E2E-only `e2e-seed` / `e2e-support`.

### Frontend Pages

**Source of truth:** `src/app/**/page.tsx`. The page map, including which routes are redirect stubs, is in [`docs/CHROME_TESTING.md` → Page map](./CHROME_TESTING.md#page-map). Which routes need a session is decided in `src/proxy.ts` (`PROTECTED_PREFIXES`, `PUBLIC_ROUTES`).

---

## What's Built

### Foundation (Complete)

- Household creation on sign-up (via onboarding)
- Household and member preferences CRUD
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
- Generated meal images

### Shopping & Pantry (Complete)

- Shopping list computation (rolling window)
- Urgency sorting with group headers
- Pantry management with ingredient search
- Auto-deduct pantry on meal completion
- Mark purchased to move an item into the pantry, and undo it
- Custom shopping items
- Missing ingredients indicators on meals

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

- [ ] Legal: Privacy Policy + Terms published and versioned consent captured at sign-up (HON-457); DPAs in place with Anthropic, Resend, Vercel, PostHog (HON-459, [`compliance/README.md`](../compliance/README.md)); the DPIA's allergen-entry affirmation (HON-666, [Risk area 2](../compliance/dpia.md)). **Open:** Neon's DPA is auto-incorporated via its ToS only — countersigned copy and billing-entity migration are HON-553
- [x] GDPR user rights: data export (Art. 20) and 30-day grace-window deletion (Art. 17) shipped; children's data needs no separate Art. 8 consent capture — see [Key Decisions → Children's Data](#childrens-data-art-8)
- [ ] Observability: PostHog installed behind cookie consent (HON-474, HON-462, HON-525); errors captured with alerts (HON-452, HON-526); core-funnel events instrumented in `src/lib/analytics.ts` (HON-476). **Open:** web vitals (unverified from repo: capture is a PostHog project setting, HON-460, and the production Web Vitals view has not been confirmed); core funnels (unverified from repo: the North Star funnel is defined in PostHog, not in code)
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
- Plan history/archive beyond the last 7 days
- Real-time multi-user sync
- Restriction templates (auto-expand "nut allergy" → specific nuts)
- Configurable time budget per household
- Meal tags for flexible categorization
- isLeftoversFriendly meal flag
- Per-day meal type configuration
- Balance rules for lunch (currently dinner-only)
- In-shop mode for shopping list (simplified UI, larger touch targets)
