# Wobblepot: AI-Powered Family Meal Planning

> **Naming note:** **Wobblepot** (pronounced "WOB-bul-pot") is the user-facing product brand. _Honkadori OÜ_ is the parent legal entity — used for vendor accounts (PostHog org, Neon org, etc.), DPAs, subprocessor listings, AKI registration. All user-facing copy and email lives on `wobblepot.com`; staging is on `wobblepot.dev`. Legal-entity attribution (Honkadori OÜ) appears in policy text, not in the email address. Brand decision recorded in HON-539; in-code brand swap completed in HON-538; staging migration completed in HON-542.

## Current Status

**Mode:** Launch readiness for public EU beta — first cohort by invitation only.

Foundation and core flows are complete (AI planning, shopping, pantry, auth, household management). Open work is the launch-readiness band: GDPR/legal, production observability, abuse protection, email deliverability, and launch hygiene (metadata, uptime). Target launch geography is EU-wide including UK-GDPR — the compliance bar is the full GDPR surface, not "soft launch to friends". First real-world user is still a family of 3 (2-year-old, second child on the way); the bar is set at public-beta because retrofitting compliance later is worse than paying the cost upfront.

Sign-up is gated behind single-use invite codes (HON-488) controlled by the `invite_code_required` PostHog kill-switch (default `true`). Flipping the flag to `false` opens public sign-up without a deploy; flipping back re-locks. This shrinks blast radius for the first cohort while keeping us one toggle away from open beta.

<!-- prettier-ignore -->
```typescript
mcp__linear-server__list_issues({})
```

---

## Vision

### Problem

- Daily "what's for dinner" decision fatigue
- Grocery management (lists, forgotten items, multiple trips)
- Nutrition balance for families with dietary/macro preferences
- Time constraints (45-60 min cooking window)
- Kid-friendly meal considerations

### Target Users

Target audience for public EU beta: families with young children across EU/EEA and UK. Initial real-world user: family of 3 (2-year-old, second child on the way). The first cohort joins by invitation only — admin mints `SignupCode` rows at `/admin/signup-codes` and shares them out-of-band; signups without a code return 403 while `invite_code_required` is `true`.

### Core Value Proposition

AI-powered meal planning that generates personalized weekly ingredient-based meal plans with nutritional transparency.

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

| Term                | Definition                                                                            |
| ------------------- | ------------------------------------------------------------------------------------- |
| **Meal**            | Template: ingredient combination with per-serving quantities. Reusable across plans.  |
| **Entry**           | Instance: meal assigned to a date + mealType with status (planned/completed/skipped). |
| **Slot**            | A date + mealType position in a plan.                                                 |
| **SlotRequirement** | Slot with required protein type (dinner-only, for balance).                           |
| **Component**       | Meal-to-ingredient link with `quantityPerServing`.                                    |
| **Candidate**       | Meal that passed hard filters, eligible for AI selection.                             |
| **Pool**            | Candidates filtered by protein type (fish, legume, any).                              |
| **Staple**          | Pantry item always assumed in stock; never on shopping list.                          |
| **Rolling window**  | Shopping aggregation: today through N days ahead.                                     |
| **Urgency bucket**  | Shopping grouping: today / tomorrow / this-week / later.                              |

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

1. Sign up with email/password
2. Land on onboarding → create household
3. Configure preferences (dietary type, allergens, meal types)
4. Optionally add manual members (kids)
5. Generate first plan

### Weekly Planning

1. View Today dashboard → navigate to Plan
2. Click "Generate this week" or "Generate next week"
3. Review plan, optionally swap meals
4. Throughout week: mark meals completed/skipped
5. On completion: pantry auto-deducts ingredients

### Mid-Week Generation

- `startDate` = Monday (plan identity)
- `effectiveStartDate` = today (entries start from today)
- Balance constraints relaxed if <5 dinner days
- Sunday generation blocked (400 error)

### Shopping

1. Navigate to Shopping page
2. Rolling window list (7 or 14 days)
3. Group by category or urgency
4. Mark purchased → adds to pantry (`quantity = null`)
5. Remove from pantry → reappears on list

### Meal Swap

1. Click swap icon on entry
2. See 3 AI alternatives or search library
3. Select replacement → entry updated

---

## Edge Cases & Gotchas

### Generation

- **Sunday current-week**: 400 error (only 1 day left)
- **<5 dinner days**: Balance constraints skipped (partial week)
- **Empty required pool**: 400 error with protein type in message
- **Regenerate**: Deletes existing plan for that week, then creates new

### Dates

- `endDate` is exclusive: Mon-Sun plan has `endDate` = next Monday
- **"Today" uses household timezone**: Not server time

### Pantry

- **Mark purchased**: Creates item with `quantity = null` ("have some")
- **Auto-deduct on completion**: Not when the day passes
- **Past meals**: Excluded from shopping calculation

---

## Key Decisions

### AI Strategy

**Decision:** AI selects from a pre-filtered candidate list.

**Why:** Database handles hard constraints (allergens, time), AI handles variety. Makes AI a "selector" not "constraint enforcer."

**Implementation:**

- **Input:** Pre-filtered candidate meals (IDs + minimal metadata)
- **Output:** Structured output: `{ entries: [{ date, mealType, mealId }] }`
- **Fallback:** If validation fails twice → manual selection from library
- **Tech:** Vercel AI SDK + Claude + Zod for structured output

| Concern                         | Handled by                              |
| ------------------------------- | --------------------------------------- |
| Allergens                       | Database query (hard filter)            |
| Excluded ingredients            | Database query                          |
| Recent history (14 days)        | Database query                          |
| Meal type match                 | Database query                          |
| Balance constraints (slots)     | Deterministic rules + DB query          |
| Dietary concepts (restrictions) | AI guidance (best effort, not enforced) |
| Variety & balance               | AI selection                            |

**Important:** Allergens are safety-critical and DB-enforced. Restrictions (e.g., "low FODMAP", "keto-ish") are free-form guidance for the AI with no guarantee of enforcement.

### Balance Constraints

**Decision:** Ensure variety via protein type slots (dinner only).

**Why:** Solves "no chicken 4 days in a row" and "fish at least once a week" without complex macro calculations.

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

**Derivation logic:** See `src/lib/meal-planning/slots.ts`

**Empty pool handling:** If a required slot's candidate pool is empty (due to allergens, exclusions, or recent history), skip that slot for the week and include a warning.

**Why this works:**

- **80% of "balance" from one derived field** - no calorie math needed
- **DB-enforced slots** - fish Wednesday is a WHERE clause, not AI hope
- **Deterministic repair** - validation failures fixed without re-calling AI
- **Composable** - works with existing pre-filter architecture

### AI Generation Flow

Key steps:

1. Compute required slots
2. Query candidate meals per slot
3. Cap and format payload for AI
4. AI selects within constraints
5. Hydrate AI response
6. Validate + repair or retry

### Data Model

**Decision:** Ingredient-level planning with Meal-as-Template pattern.

**Why:** One "Chicken Rice Bowl" template works for any household size. Users have freedom in preparation method.

**Implementation:**

- **Meal** = Template (named combination of ingredients with per-serving quantities)
- **MealPlanEntry** = Instance (meal template assigned to a date, quantities calculated for household)
- **Shopping List** = Computed from MealPlanEntry minus pantry stock

**Units:** Each ingredient has a `defaultUnit` (g or piece). All quantities use this unit everywhere. Liquids stored in grams; use `densityGPerMl` for UI display.

**Dates & Timezones:** Store as UTC midnight in household timezone. Each household has a `timezone` field (default Europe/Tallinn).

**Allergens vs Restrictions:**

- `allergens` = safety-critical, DB-enforced via `Allergen` enum
- `restrictions` = dietary concepts ("low FODMAP") - free-form String\[\], AI interprets with best-effort

**Enums over strings:** Use Prisma enums for constrained values to prevent inconsistent data.

### Onboarding

- Prompt to create household after sign-up
- User configures household preferences
- Shareable invite links for family members

### Meal Scheduling

**Decision:** Weekday/weekend split for meal type configuration.

**Why:** Most families have different patterns on weekends.

**Implementation:**

- `weekdayMealTypes`: Which meals to plan Mon-Fri (default: dinner only)
- `weekendMealTypes`: Which meals to plan Sat-Sun (default: dinner only)

### Meal Plan Rules

- **Duration:** Fixed 7 days (weekly planning)
- **Start day:** Monday enforced
- **endDate:** Computed as `startDate + 7 days`
- **Overlapping plans:** Not allowed - unique constraint on `[householdId, startDate]`
- **Meal editing:** Both "regenerate" and "browse library" options

### Pantry & Shopping List

**Decision:** Computed shopping list from plan minus pantry.

**Why:** Pantry is persistent state; shopping list is derived. Simpler than syncing.

**Auto-deduction:** When marking a meal as completed, pantry quantities are automatically reduced.

**Rolling window:** Shopping list shows items needed for upcoming meals (not fixed to week boundaries).

### Household Invites

**Decision:** Multi-use shareable links.

**Why:** Simple, no email required, suitable for family sharing.

**Known limitation:** Race condition on concurrent invite use. Acceptable for MVP given low traffic.

### Children's Data (Art. 8)

**Decision:** No in-app parental-consent capture — no under-16 flag, no consent timestamp, no acknowledgment checkbox. Art. 8 is not an open launch gate.

**Why:** Art. 8 governs a child's _own_ consent to an information society service offered directly to them. Wobblepot has no child accounts: a household member profile is created and managed by the account-holding parent or guardian, who is the one consenting. A checkbox shown to that same parent adds evidentiary ceremony, not a missing legal basis. The substantive control is the Art. 9 health-data position on allergen and dietary data, which applies to every member — adults included — and rests on the privacy policy's AI-processing disclosure rather than on an under-16 toggle. That position is not fully settled: [`compliance/dpia.md`](../compliance/dpia.md) rates "Art. 9 basis challenged" as its only Medium residual risk, and calls the missing allergen-entry affirmation "the honest gap" whose residual risk is accepted at beta scale — see **Already open** below.

**Where this is recorded:**

- Privacy policy → "Children's data" (`src/app/(legal)/privacy/page.tsx`) — accounts are for people aged 16 or over across all EU/UK jurisdictions, and adding a member under 16 is the parent or guardian confirming they consent on the child's behalf. Read the live wording there rather than a copy here; `page.test.tsx` pins only the "aged 16 or over" and "parent or legal guardian" substrings, not the whole sentence.
- [`compliance/dpia.md`](../compliance/dpia.md) → Risk area 1 — reviewed this position and concurs. Also records the data-minimisation posture: no DOB, no photos, not even an under-16 flag is stored.
- HON-467 (Canceled 2026-06-06) carries the original decision on its comment thread.

**Revisit if:** standalone child accounts ever ship — Art. 8 then applies for real — or AKI/EDPB guidance moves on children's data.

**Already open (Art. 9, not Art. 8):** [`compliance/dpia.md`](../compliance/dpia.md) → Risk area 2 recommends a one-line affirmation in the member form where allergens are entered, for all members rather than only under-16s, and its Conclusion carries this as the one open recommendation, due **pre-public-launch**. That is a live launch-readiness item, not a later gate: Current Status sets the bar at public EU beta rather than "soft launch to friends", and flipping `invite_code_required` opens public sign-up without a deploy. It is tracked on the **Legal** line of the launch-readiness checklist, and it does not reopen the Art. 8 decision above.

### Error Handling

**AI Failures:**

- Timeout: 30 seconds max, show "Taking longer than expected" at 10s
- Retry: Automatic retry once on failure
- Fallback: Manual meal selection from pre-filtered candidates
- Rate limiting: 5 plan generations per hour per household

### Scope Boundaries

**In scope for MLP:**

- Ingredient combinations, not full recipes
- Weekly meal planning with preferences
- Weekday/weekend meal type scheduling
- Shopping list generation (computed, rolling window)
- Pantry tracking with auto-deduction
- Mobile-responsive web
- Shareable household invite links
- Progress animation for AI generation
- Nutrition disclaimers
- DB-enforced allergen filtering
- Balance constraints via protein type slots
- Today dashboard as default home
- Manual household members (for kids, etc.)
- Account deletion

**Out of scope:**

- Meal ratings and learning
- Conversational refinement
- PWA/offline
- Full recipe instructions
- Monetization/subscriptions
- Multi-household switcher
- Email-based invites
- Plan history/archive
- Real-time multi-user sync

---

## Technical Reference

_For tech stack and versions, see [CLAUDE.md](../CLAUDE.md). This section covers domain-specific technical details._

### Environment Variables

```
ANTHROPIC_API_KEY    # Required for AI meal generation
DATABASE_URL         # Neon PostgreSQL
BETTER_AUTH_SECRET   # Auth secret
```

### Global Constants

```typescript
const NO_REPEAT_DAYS = 14 // Don't repeat meals within this window
const AI_TIMEOUT_MS = 30000 // AI generation timeout
const AI_RETRY_LIMIT = 1 // Retry once on validation failure
const RATE_LIMIT_PER_HOUR = 5 // Plan generations per household
const CANDIDATE_POOL_LIMIT = 50 // Max candidates per pool sent to AI
```

### Database Schema

**Source of truth:** `prisma/schema.prisma`

Key models:

- `Household`, `HouseholdMember`, `HouseholdPreferences`, `MemberPreferences` - Multi-tenancy
- `HouseholdInvite` - Shareable invite links
- `Ingredient`, `Meal`, `MealComponent` - Meal templates
- `MealPlan`, `MealPlanEntry` - Weekly plans
- `PantryItem` - Inventory tracking

Key enums: `DietaryType`, `MealType`, `MealPlanEntryStatus`, `Unit`, `IngredientCategory`, `HouseholdRole`, `Allergen`, `ProteinType`

### API Routes

- `/api/auth/*` - Better Auth
- `/api/households` - Create household
- `/api/households/me` - Get/update current household
- `/api/households/me/preferences` - Household preferences
- `/api/households/me/members` - List members
- `/api/households/me/members/[id]` - Update/delete member
- `/api/households/me/invites` - List/create invites
- `/api/households/me/invites/[id]` - Delete invite
- `/api/households/me/meals` - Household meal library
- `/api/households/me/meals/[id]` - Get/update/delete meal
- `/api/members/me/preferences` - Current member preferences
- `/api/invites/[code]/join` - Join via invite
- `/api/meals` - Browse/create meals
- `/api/meals/[id]/favorite` - Toggle favorite
- `/api/ingredients` - List/search ingredients
- `/api/pantry` - List/create pantry items
- `/api/pantry/[id]` - Update/delete pantry item
- `/api/pantry/by-ingredient/[ingredientId]` - Get by ingredient
- `/api/meal-plans/generate` - Generate plan
- `/api/meal-plans/current` - Get current plan
- `/api/meal-plans/[id]` - Get/delete specific plan
- `/api/meal-plans/[id]/entries` - List entries
- `/api/meal-plans/[id]/entries/[entryId]` - Update entry
- `/api/meal-plans/[id]/entries/[entryId]/regenerate` - Get alternatives
- `/api/meal-plans/[id]/entries/[entryId]/suggestions` - Get swap suggestions
- `/api/meal-plans/[id]/entries/[entryId]/preparation-tips` - Get cooking tips
- `/api/meal-plans/[id]/shopping-list` - Get shopping list
- `/api/meal-plans/[id]/shopping-list/purchase` - Mark items purchased
- `/api/meal-plans/[id]/shopping-list/unpurchase` - Unmark purchased
- `/api/shopping-list` - Unified shopping list
- `/api/shopping-list/purchase` - Mark purchased (unified)
- `/api/shopping-list/unpurchase` - Unmark purchased (unified)
- `/api/recipes/parse` - Parse recipe from URL

### Frontend Pages

- `/` - Today dashboard (default home)
- `/meal-plan` - Weekly plan with status controls and week navigation
- `/shopping` - Unified shopping list with urgency sorting
- `/pantry` - Pantry management
- `/recipes` - Recipe/meal library
- `/recipes/import` - Import recipe from URL
- `/household` - Household settings and members
- `/household/invites` - Manage invite links
- `/profile` - Personal preferences and account
- `/onboarding` - New user household setup
- `/sign-in` - Login
- `/sign-up` - Registration
- `/forgot-password` - Password reset request
- `/reset-password` - Password reset form
- `/invite/[code]` - Join household via invite link

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

- AI meal plan generation with slot-based balance
- Plan validation and repair logic
- Weekly plan dashboard with week navigation
- Meal detail view with nutrition
- Meal swap via AI alternatives or library browse
- Progress animation for generation
- ~100 meals in library

### Shopping & Pantry (Complete)

- Shopping list computation (rolling window)
- Urgency sorting with group headers
- Pantry management with ingredient search
- Auto-deduct pantry on meal completion
- Real-time UI updates
- Missing ingredients indicators on meals
- "Have it" quick toggle

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

- [ ] Legal: Privacy Policy + Terms published; consent captured at sign-up; DPAs signed with Anthropic, Resend, Vercel, Neon; DPIA's open allergen-entry affirmation ([Risk area 2](../compliance/dpia.md))
- [x] GDPR user rights: data export (Art. 20) and 30-day grace-window deletion (Art. 17) shipped; children's data needs no separate Art. 8 consent capture — see [Key Decisions → Children's Data](#childrens-data-art-8)
- [ ] Observability: PostHog installed behind cookie consent; errors, web vitals, and core funnels captured
- [ ] Abuse protection: durable rate limits (Upstash Redis) on auth + generation; AI per-household cost cap
- [ ] Email: SPF/DKIM/DMARC aligned; password-reset reliably lands in inbox
- [ ] CI safety net: E2E re-enabled in CI; sign-up, generation, invite, and shopping→pantry flows covered
- [ ] Launch hygiene: `/api/health` + uptime monitor; `not-found.tsx`, `robots.ts`, `sitemap.ts`, OG metadata

---

## Future Considerations

_Ideas for later. Some may be pulled into MLP iteration if they feel essential._

- ~~Auto-depletion when meals marked completed~~ Done
- ~~Urgency sorting for shopping~~ Done
- ~~Rolling window shopping list~~ Done
- Expiry tracking & "use soon" suggestions
- Preparation guidance (AI cooking tips)
- Calorie-aware meal planning
- Kid-friendly filtering in AI validation
- Cooking time optimization
- Meal ratings and favorites
- Full recipe instructions
- PWA offline capabilities
- Multi-household support
- Email-based invites
- Plan history/archive
- Real-time multi-user sync
- Restriction templates (auto-expand "nut allergy" → specific nuts)
- Configurable time budget per household
- Meal tags for flexible categorization
- isLeftoversFriendly meal flag
- Per-day meal type configuration
- Balance rules for lunch (currently dinner-only)
- In-shop mode for shopping list (simplified UI, larger touch targets)
