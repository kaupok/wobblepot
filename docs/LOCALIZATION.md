# Localization

The durable record of how this product approaches localization, what's wired today, and how to extend it. Philosophy comes from [HON-499](https://linear.app/honkadori/issue/HON-499); operational details reflect what's actually on `main`.

## Why this exists

Localization isn't "make the app Estonian." It's making the product speak to a specific user _at the moments she's thinking in Estonian_. Our target first family has a partner who reads English fluently — she's fine signing in, navigating, reading error messages. But when she's planning the week's meals or walking the store with a shopping list, her mental mode switches. That switch is what this initiative serves.

**Success criterion:** the partner plans meals and shops for a week, and doesn't notice language getting in her way. Not "the app has Estonian strings." A product-quality test using the target user as the acceptance gate.

## Three-tier surface model

Different surfaces get different quality bars and different disciplines. Don't apply uniform effort.

| Tier                         | What                                                                                                            | Discipline                                          | Cadence                                    |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | ------------------------------------------ |
| **1 — living product voice** | AI-generated content in the moment of use: imagined meals, swap suggestions, prep tips, parsed recipes          | Prompt engineering, voice judgment, iteration       | Never fully "done"                         |
| **2 — domain content**       | Seeded meal names, ingredient names, category headers, meal-type labels — what the partner reads while shopping | Translation work: AI first pass + native review     | Ships once per locale                      |
| **3 — chrome**               | "Sign in", "Profile", form labels, toast messages                                                               | Codebase externalization sweep + translation volume | Parallel fast-follows; not launch-critical |

Tier 1 is the highest leverage. Most meals a household encounters over time are AI-generated, not seeded — if the AI sounds translated, the whole experience feels second-class no matter how perfect the chrome is.

## Decided principles

These are settled. Don't re-open without cause.

- **English is canonical.** Translations are overlays. Fallback to English when a translation is missing.
- **Household-scoped locale.** `Household.locale` is a sibling to `Household.timezone`. Anonymous / pre-household users resolve from `Accept-Language`. User-scoped override within a household is a future concern.
- **Global ingredient pool stays curated.** User- and AI-created ingredients are household-scoped and stored in the _creator's_ locale. Promotion to the global pool happens via an admin flow, not silently.
- **Per-household content retains creator-time locale.** Switching a household's locale does not re-translate user-created meals, imported recipes, or AI-generated notes. Seeded content and enum labels switch; user-created content stays in the locale it was created in. Mixed-locale library state is accepted by design.
- **1:1 mapping, no cultural adaptation.** Same ingredient row, different display name. No locale-only meals, no dropping culturally-English meals (e.g. "Tuna melt"). Accept minor semantic drift.
- **Content is data, not code.** Translations should edit without deploys. "Done" means _ship a baseline, iterate on real signal_, not _achieve perfection before merge_.
- **Quality is asymmetric.** Tier 1 needs judgment + iteration; Tier 2 needs review; Tier 3 needs volume.
- **Platform over localization.** Architecture supports N locales. Adding Finnish or Russian later is content work, not engineering.
- **Partner is both target user and quality gate.** Acceptance is real-world use, not synthetic checks.
- **Rollback lever exists.** Removing a locale from `KNOWN_LOCALES` reverts every household on that locale to English chrome without data loss. Translation rows stay in the DB for re-enable later.

## How it's wired today

### Schema & data

- `Household.locale: String @default("en")` — BCP 47 tag, validated against `KNOWN_LOCALES` at the API boundary via `LocaleSchema`.
- `IngredientTranslation(ingredientId, locale, name)` — overlays for global ingredients.
- `MealTranslation(mealId, locale, name, description, ...)` — overlays for seeded meals.
- AI- and user-created `Ingredient` rows carry `householdId`; global rows have `householdId IS NULL`. The matcher (`fuzzySearchIngredient` in `src/lib/ai/fuzzy-ingredient-match.ts`) prioritises global > household > translation, so a translation-based match still resolves to the canonical English `ingredient.name`.
- **Fixing a translation after launch** — a wrong Estonian ingredient or meal name is a scoped SQL `UPDATE` against the overlay row, which makes the fix visible without a deploy. It must then be mirrored into `prisma/seed-{ingredient,meal}-translations-et.ts`, because `pnpm db:seed` runs on every production migration deploy and re-asserts the checked-in data over the database. The procedure, the safety rules, and the audit log live in [`RUNBOOKS/translation-maintenance.md`](RUNBOOKS/translation-maintenance.md). That runbook also documents the whole-locale rollback lever.

### Locale resolution

`src/lib/i18n/`:

- `locales.ts` — `KNOWN_LOCALES = ['en', 'et']`, `PUBLIC_LOCALES = ['en', 'et']`, `LocaleSchema`, `DEFAULT_LOCALE = 'en'`, helpers `isKnownLocale` / `isPublicLocale` / `isDefaultLocale`. **`KNOWN_LOCALES` is what the DB and API accept; `PUBLIC_LOCALES` is what the locale selector exposes to general users.** The two sets are identical today (HON-549 widened `PUBLIC_LOCALES` to include Estonian) — the distinction is kept so a future locale can land in the DB / translation tables before being exposed in the selector. New locales should only join `PUBLIC_LOCALES` once transactional email templates exist in that locale — HON-513 closed that gap for Estonian; see [Transactional email](#transactional-email) below.
- `accept-language.ts`, `resolve-locale.ts` — pre-household locale resolution from headers.
- `get-locale.ts`, `request.ts` — server-side locale plumbing for `next-intl`.

### Chrome (Tier 3)

- `next-intl` for UI strings. Catalogs in `messages/en.json` and `messages/et.json`.
- `enum-label.ts` provides `useEnumLabel` (client) for domain-enum rendering — meal types, ingredient categories, dietary types, etc. There is no server-side variant: render enum labels in a client component, or read `enums.<EnumName>.<value>` via `getTranslations` directly at the RSC call site.
- `format-number.ts`: `formatQuantity` and `formatInteger` — locale-aware decimal separator (`1.5` vs `1,5`).
- `format-dates.ts`: locale-aware weekday / month / relative-date rendering. Always pass the household's locale, never hardcode `en-US`.
- `parse-number.ts`: input-side counterpart to `formatQuantity` — accepts `1,5 kg` from Estonian users and parses to `1.5`.
- `og-locale.ts`: maps app locales to OpenGraph locale strings for per-route metadata.
- ICU MessageFormat plural rules live in the `messages/{en,et}.json` catalogs; `next-intl` resolves them at render time. `src/lib/i18n/plurals.test.tsx` covers the contract.
- `content.ts`: `translateIngredient` and friends — resolves the right display string for translatable content.

### AI surfaces (Tier 1)

- Every call site in `src/lib/ai/*.ts` accepts a `locale` parameter. The shared `localeInstruction(locale)` in `src/lib/ai/prompts.ts` returns an empty string for the default locale (so English flows are byte-identical to pre-i18n) and an explicit `LOCALE: Produce all user-visible output in <Language>` block otherwise.
- The three surfaces that emit user-visible free text (imagine-meal, recipe parsing, preparation tips) append an Estonian voice block after that: `estonianVoiceForImagineMeal`, `estonianVoiceForRecipeParse`, and `estonianVoiceForPrepTips`, also in `prompts.ts`. Each carries register rules plus few-shot pairs and returns an empty string for every locale but `et`. The rules and pairs are distilled from [`AI_VOICE_ET.md`](./AI_VOICE_ET.md), the canonical voice reference; change the doc first, then the helper. Plan generation and quantity review produce no free text and carry only `localeInstruction`.
- AI-created ingredients are stored with `householdId = <current household>` in the creator's locale. No "English canonical" enforcement on AI creations — the global-pool rule is preserved because household-scoped rows don't pollute global.
- AI response caches must include `locale` in the key to avoid cross-locale contamination. The one stored cache — `MealPlanEntry.preparationTips` — honours that by invalidation rather than by keying: `PATCH /api/households/me` nulls every entry's tips inside the household-update transaction when the locale changes, and `PATCH /api/meal-plans/[id]/entries/[entryId]` nulls that entry's when its `servingOverride` changes, since the prompt also scales by the effective serving count (HON-681). `PATCH /api/households/me/meals/[id]` does the same for every entry of a meal when an edit _changes_ a field the prompt consumes — `name`, `timeMinutes`, `preparationNotes`, or the component list scaled by `servings` — and deliberately not when it changes only something the prompt never sees, such as `sourceUrl`. It compares against the stored meal rather than testing which fields were sent, because the meal form PATCHes its whole payload on every save (HON-683). A household's **member count** is a further input, because the effective serving count falls back to it whenever an entry carries no `servingOverride` — the default state — so every membership write clears the cache too, via `invalidateFutureEntryTips` in `src/lib/meal-planning/preparation-tips-cache.ts`: the manual-member add (`POST /api/households/me/members`), the removal (`DELETE /api/households/me/members/[id]`), and the account purge that drops a membership from a household that survives it (`src/lib/auth/purge-user.ts`). That one is bounded to entries dated **today or later** that are not already `completed`, and to entries without an override: tips for a meal already cooked are never read again, so regenerating them would be pure AI spend, and an entry with an override was priced from the override rather than from the member count (HON-684). The `status` clause is what makes the date bound honest — a dinner cooked at 18:00 is still dated today at 20:00 — and it is `not: 'completed'` rather than `'planned'` so a later un-skipped entry does not come back holding tips priced at the old count; leaving `completed` nulls them at the entry PATCH, so skipping defers the invalidation to the revert rather than dropping it. The invite-accept path claims a pre-existing member row instead of creating one, so it leaves the count — and the cache — alone. The count is also re-read in `preparation-tips/route.ts` just before the cache write, alongside the `mealId` / `servingOverride` / `locale` / `meal.updatedAt` filters pinned there: an entry that is mid-generation holds `preparationTips: null`, so no invalidation can reach it, and an unguarded write would put the old household size's tips back permanently.
- After every successful `generateObject` call, `logAiSample` (see [Reviewing AI output quality](#reviewing-ai-output-quality)) emits a structured JSON line if the locale is non-default.

The Estonian recipe-parser surface was gated behind `FEATURE_RECIPE_PARSER_ET` until ingredient translations landed — Estonian input without translation data created duplicate household-scoped ingredient rows that needed admin cleanup later (HON-514). HON-506 seeded an Estonian translation for every global ingredient and **retired that gate**: `resolveParserLocale` in `src/app/api/recipes/parse/route.ts` now threads the household locale straight through, and the matcher resolves Estonian ingredient names directly. The env flag no longer exists.

The selector + onboarding-clamp gate (`FEATURE_PUBLIC_LOCALES_FULL`, plus the `effectivePublicLocales` / `isEffectivelyPublicLocale` helpers) was retired in HON-549 alongside the public flip. With `PUBLIC_LOCALES = ['en', 'et']`, the selector in `src/app/household/household/HouseholdSettingsForm.tsx` reads `PUBLIC_LOCALES` directly, and `src/app/api/households/route.ts` persists the `resolveLocale` result without clamping. Removing the env var from Vercel (staging + production) is a manual follow-up tracked in the HON-549 PR.

### Transactional email

Two templates are localized (HON-513): `src/lib/emails/reset-password.ts` and `src/lib/emails/account-deletion-requested.ts`. Both are pure functions taking `{ ..., locale }` and returning `subject` / `html` / `text`, with `<html lang>` set from that locale.

- **Copy** lives in `messages/{en,et}.json` under `emails.<template>`, so `catalogue-parity.test.ts` enforces en/et parity for email strings too.
- **Catalog access** goes through `emailTranslator(locale, namespace)` in `src/lib/emails/i18n.ts`, which wraps `createTranslator` over statically imported catalogs, with the `emails` namespace overlaid on English so a missing key degrades to an English sentence instead of a rendered key path. `getTranslations` is deliberately _not_ used: it resolves the locale via `getRequestConfig` → `getLocale()` → `headers()`, and the Better Auth `sendResetPassword` hook has no guaranteed request scope.
- **Locale resolution** is at the call site, via `resolveEmailLocale(userId)` in `src/lib/emails/locale.ts` — household locale only, validated against `PUBLIC_LOCALES`, falling back to `en` for a user with no household, an unrecognised locale, or a failed lookup. `Accept-Language` is not consulted: it is unavailable in the Better Auth hook, and household locale is the stronger signal anyway.
- **Mixed HTML/plain-text strings** (the bolded purge date, the linked recovery address) use one key with `t.markup`, which returns a string — `t.rich` returns a `ReactNode` and is unusable here.
- `breach-notification.ts` is English-only by design — see [Out of scope](#out-of-scope).

### Form input parsing

`parse-number.ts` handles locale-aware decimal-separator parsing for numeric form inputs (pantry quantities, recipe-create, shopping). Estonian users typing `1,5 kg` get `1.5` parsed; English users typing `1.5 kg` work unchanged. Display formatting (`Intl.NumberFormat` via `formatQuantity`) is the output-side counterpart.

## Reviewing AI output quality

Every non-default-locale AI call emits a structured `[ai-sample]` JSON line containing the AI input and output (no household / user IDs). This closes the iteration loop for ongoing voice tuning without requiring an admin page or DB table. Implementation: `src/lib/ai/sampling.ts`.

### Locally (`pnpm dev`)

Each sample is appended to `.ai-samples/<YYYY-MM-DD>.jsonl` (gitignored).

```bash
# Watch today's samples live
tail -f .ai-samples/$(date +%Y-%m-%d).jsonl | jq '.'

# Last 20 Estonian meal names produced by imagine-meal
jq -r 'select(.callSite == "imagine-meal") | .output.meals[].name' \
  .ai-samples/*.jsonl | tail -20

# Last 20 parsed recipe names
jq -r 'select(.callSite == "parse-recipe") | .output.name' \
  .ai-samples/*.jsonl | tail -20

# Filter by locale
jq -c 'select(.locale == "et")' .ai-samples/*.jsonl | tail -20
```

No automatic cleanup. Suggested practice: `find .ai-samples -name "*.jsonl" -mtime +30 -delete` if the directory grows.

### Staging / production (Vercel)

Vercel auto-captures stdout. In the deployment's log explorer, filter for the `[ai-sample]` prefix:

```
"[ai-sample]"
```

Each line is a single JSON record after the prefix. Retention is bounded by Vercel log retention (~30 days, plan-dependent). No DB writes, no PostHog, no long-term storage.

### Privacy contract

`logAiSample` trusts callers to strip identifiers — never pass `householdId`, `userId`, session tokens, or anything else that could re-identify a request. The helper is also `try/catch`-wrapped; failures log to `console.error` but never break the AI call.

## Adding a new locale

1. Add the BCP 47 tag to `KNOWN_LOCALES` in `src/lib/i18n/locales.ts`. **Do not** add to `PUBLIC_LOCALES` yet — chrome catalog must be complete first.
2. Add a label for the locale in `LOCALE_LABELS` in `src/lib/ai/prompts.ts` so the AI gets a human-readable language name.
3. Create `messages/<locale>.json` and translate every key. Run `pnpm dev` and exercise every chrome surface to surface gaps.
4. Translate seeded content via the `IngredientTranslation` and `MealTranslation` tables. AI-assisted first pass + native-speaker review.
5. Seed step 4 **before** exposing the new locale. `resolveParserLocale` in `src/app/api/recipes/parse/route.ts` threads the household locale straight through (the `FEATURE_RECIPE_PARSER_ET` gate was retired in HON-506), so a new-locale household reaches the recipe parser immediately — and without seeded `IngredientTranslation` rows the matcher can't resolve names, recreating the duplicate household-scoped ingredient problem (HON-514) the old gate guarded against. The **selector** reads `PUBLIC_LOCALES` directly today (HON-549 retired the staging-only env-flag override), so the new locale is not offered in household settings until it lands there. **Onboarding is not clamped**, though: `POST /api/households` persists `resolveLocale`'s result as-is (`src/app/api/households/route.ts:50`), and `resolveLocale` / `matchAcceptLanguage` gate on `isKnownLocale`, not `isPublicLocale` — which has no non-test callers. A browser sending the new locale in `Accept-Language` will therefore be onboarded into it the moment it joins `KNOWN_LOCALES`. Keep it out of `KNOWN_LOCALES` until it is ready, or add the clamp.
6. **RTL languages only:** add a `direction` field to a parallel map, set `<html dir>` from it in `src/app/layout.tsx`, and audit Tailwind direction-sensitive utilities (`mr-`, `ml-`, `pl-`, `pr-` → `me-`, `ms-`, `pe-`, `ps-`). Tracked as deferred — the codebase currently assumes LTR.
7. Pilot-test with a target user before adding to `PUBLIC_LOCALES`.
8. Add to `PUBLIC_LOCALES` to expose in the locale selector. Before flipping public, add the locale's copy to the `emails` namespace in `messages/<locale>.json`. `emailTranslator` overlays the locale's `emails` namespace on English, so a key the new catalog is missing degrades to an English sentence rather than to next-intl's default fallback (the literal key path — `emails.resetPassword.cta` in a CTA button). That overlay is a floor, not a safety net: a key that is _present_ but whose ICU syntax is malformed still renders the key path, and `catalogue-parity.test.ts` compares `en.json` against `et.json` by name, so extend it to the new catalog rather than assuming it is covered. See [Transactional email](#transactional-email).

## Adding a new AI call site

Any new `generateObject` (or equivalent) call must:

1. Accept `locale: string` (or `locale?: string`) and pass it into prompt construction via `localeInstruction(locale)` from `src/lib/ai/prompts.ts`.
2. Include `locale` in any caching key for the AI response.
3. After a successful call, invoke `logAiSample({ callSite, locale, input, output })`. Keep `input` to AI-visible context only (no IDs). Add the call site name to the `AiSampleCallSite` union in `src/lib/ai/sampling.ts`.
4. If the call site lives outside `src/lib/ai/`, add the same locale-threading test (English vs Estonian prompt assertion) plus a sampling-helper-was-invoked test.
5. If the call site creates `Ingredient` rows from AI output, scope them to `householdId = <current>` in the creator's locale — never insert into the global pool.

## Out of scope

Architectural decisions that the platform supports but we deliberately don't ship:

- **Multi-household switching** within a single user account.
- **User-level locale override** within a household. Household locale is the unit.
- **Cultural adaptation** — no locale-specific meal swaps or ingredient substitutions. Same row, different display name.
- **Automated AI quality scoring** (LLM-as-judge). Sampling exists for human review, not synthetic grading.
- **Localized `breach-notification.ts`.** The GDPR Art. 33/34 breach email is sent by an operator following a runbook, to an audience that is not locale-resolvable at send time. Deliberately English-only (HON-513).
- **Mid-lifetime locale-change UX** (visual markers, on-demand translation, switch-time prompts). Silent mixed state by design.
- **Sentry / PostHog locale tagging** (HON-516). Not yet wired; useful for triage during partner-test windows but not blocking.
- **Non-Estonian AI output sampling.** English is "known good" and excluded by design from `logAiSample`.

## Cross-references

### Code

- `src/lib/i18n/` — locale resolution, framework wiring, formatters, parsers.
- `src/lib/ai/prompts.ts` — `localeInstruction` shared across AI call sites, plus the three `estonianVoiceFor*` helpers.
- `src/lib/ai/sampling.ts` — `logAiSample` and the call-site union.
- `prisma/schema.prisma` — `Household.locale`, `IngredientTranslation`, `MealTranslation`.
- `messages/{en,et}.json` — chrome catalogs.

### Docs

- [`AI_VOICE_ET.md`](./AI_VOICE_ET.md) — Estonian AI voice reference: register, naming, description and prep-note voice with good/bad pairs, and the rework-vs-parameterize rule for inflected templates.
- [`RUNBOOKS/translation-maintenance.md`](RUNBOOKS/translation-maintenance.md) — post-launch translation fixes: scoped SQL, rollback, audit log.

### Linear

- [HON-499](https://linear.app/honkadori/issue/HON-499) — parent epic, full philosophy and sub-issue map.
- HON-500 / 501 / 502 — platform sub-issues (schema, framework, AI threading).
- HON-503 — AI voice + prompt tuning across call sites.
- HON-504 — AI output sampling (this doc's review tooling).
- HON-505 / 506 / 507 — Tier 2 content translations.
- HON-508 / 509 / 510 / 511 — Tier 3 chrome.
- HON-512 — partner test.
- HON-513 — transactional email localization (password reset, account deletion).
- HON-514 — admin promotion of household-scoped ingredients to the global pool.
- HON-515 — input-side decimal-separator parsing.
- HON-516 — Sentry / PostHog locale tagging (deferred observability).
- HON-517 — post-launch translation maintenance workflow.
