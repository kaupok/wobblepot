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
- **Global ingredient pool stays curated.** Only the seed and migrations add global ingredients. The schema also supports household-scoped ingredients (`householdId` set), and the matcher and display handle them, but nothing creates them today: no code path writes an `Ingredient` at runtime, the recipe parser's unmatched rows must be resolved to an existing ingredient, and `POST /api/households/me/meals` rejects unknown ingredient ids. If a creation path is added, its rows are household-scoped and stored in the _creator's_ locale. There is no promotion path to the global pool (decided 2026-09-30, HON-873): such a row would stay in its household, in the creator's locale, with no translation row, so two households that both create "lovage" would get two rows. That is accepted during the invite-only beta. Revisit when public sign-up opens (the `invite_code_required` flag turned off), which is when duplicates would start to accumulate. If a path is built, the stated preference is a mechanism the operator runs through Claude Code (a script or skill in the repo, like `/audit-ingredients` and `scripts/audit-ingredients/`), not an admin page. That is a preference, not a design.
- **Per-household content retains creator-time locale.** Switching a household's locale does not re-translate user-created meals, imported recipes, or AI-generated notes. Seeded content and enum labels switch; user-created content stays in the locale it was created in. Mixed-locale library state is accepted by design.
- **1:1 mapping, no cultural adaptation.** Same ingredient row, different display name. No locale-only meals, no dropping culturally-English meals (e.g. "Tuna melt"). Accept minor semantic drift.
- **Content is data, not code.** Translations should edit without deploys. "Done" means _ship a baseline, iterate on real signal_, not _achieve perfection before merge_.
- **Quality is asymmetric.** Tier 1 needs judgment + iteration; Tier 2 needs review; Tier 3 needs volume.
- **Platform over localization.** Architecture supports N locales. Adding Finnish or Russian later is content work, not engineering.
- **Partner is both target user and quality gate.** Acceptance is real-world use, not synthetic checks. Estonian went public without its partner test; see [Adding a new locale](#adding-a-new-locale) step 7.
- **Rollback lever exists.** Removing a locale from `KNOWN_LOCALES` reverts every household on that locale to English without data loss: chrome, seeded content names, and AI prompts and output, because every server read of `household.locale` goes through `resolveHouseholdLocale` (HON-921). Translation rows and the stored `Household.locale` stay in the DB for re-enable later. What it does not revert, and the full procedure, are in [`RUNBOOKS/translation-maintenance.md`](RUNBOOKS/translation-maintenance.md#a-whole-locale).

## How it's wired today

### Schema & data

- `Household.locale: String @default("en")` — BCP 47 tag, validated against `KNOWN_LOCALES` at the API boundary via `LocaleSchema`.
- `IngredientTranslation(ingredientId, locale, name)` — overlays for global ingredients.
- `MealTranslation(mealId, locale, name, description, ...)` — overlays for seeded meals.
- Global `Ingredient` rows have `householdId IS NULL`; a household-scoped row would carry `householdId`, though none is created today (see [Decided principles](#decided-principles)). The matcher (`fuzzySearchIngredient` in `src/lib/ai/fuzzy-ingredient-match.ts`) searches the global names, the household's rows and the locale's translation names, and ranks by similarity, so an exact Estonian translation beats a partial English hit (HON-912). Source only breaks ties: in a non-default locale translation > household > global (Estonian "paprika" is bell pepper, not the spice), in English global > household. A translation-based match still resolves to the canonical English `ingredient.name`; the name it matched on is returned as `matchedName`, and the word-level safety checks in `match-ingredients.ts` compare against that. Normalisation, aliases and synonyms (`normalize-ingredient.ts`, `ingredient-aliases.ts`) are English-only. The ingredient search (`GET /api/ingredients`) also finds a global row by another English name in `INGREDIENT_SYNONYMS` and returns the household's display name with the typed English name as `matchedAs`, which the dropdowns show in brackets (HON-1100).
- **Fixing a translation after launch** — a wrong Estonian ingredient or meal name is a scoped SQL `UPDATE` against the overlay row, which makes the fix visible without a deploy. It must then be mirrored into `prisma/seed-{ingredient,meal}-translations-et.ts`, because `pnpm db:seed` runs in the production migration workflow and re-asserts the checked-in translations over the database. That workflow is manual (release step 4a in [`DEPLOYMENT.md`](DEPLOYMENT.md)) and the code deploy does not depend on it, so the seed runs on every release only when step 4a is followed. Renaming a seeded ingredient or meal is not a translation fix and needs a migration; the runbook has that procedure too. The procedure, the safety rules, and the audit log live in [`RUNBOOKS/translation-maintenance.md`](RUNBOOKS/translation-maintenance.md). That runbook also documents the whole-locale rollback lever.

### Locale resolution

`src/lib/i18n/`:

- `locales.ts` — `KNOWN_LOCALES = ['en', 'et']`, `PUBLIC_LOCALES = ['en', 'et']`, `LocaleSchema`, `DEFAULT_LOCALE = 'en'`, helpers `isKnownLocale` / `isPublicLocale` / `isDefaultLocale`. **`KNOWN_LOCALES` is what the DB and API accept; `PUBLIC_LOCALES` is what the locale selector exposes to general users.** The two sets are identical today (HON-549 widened `PUBLIC_LOCALES` to include Estonian) — the distinction is kept so a future locale can land in the DB / translation tables before being exposed in the selector. New locales should only join `PUBLIC_LOCALES` once transactional email templates exist in that locale — HON-513 closed that gap for Estonian; see [Transactional email](#transactional-email) below.
- `resolve-locale.ts` — `resolveHouseholdLocale(household)` returns the stored locale when it is in `KNOWN_LOCALES` and `DEFAULT_LOCALE` otherwise. **Every server read of `household.locale` that feeds display, a translation overlay or an AI prompt goes through it**; never pass the raw string, and never cast it `as Locale`. The two exceptions compare the stored value rather than display it: the `PATCH /api/households/me` change check and the preparation-tips cache guard. `resolveLocale({ householdLocale, acceptLanguage })` uses the same rule for a signed-in household and reads `Accept-Language` only when there is no household (onboarding, signed-out pages).
- `accept-language.ts` — quality-weighted `Accept-Language` parsing; `q=0` entries are refusals and are dropped.
- `get-locale.ts`, `request.ts` — server-side locale plumbing for `next-intl`. `getLocale()` is wrapped in React `cache()` for the RSC path. `cache()` does not dedupe inside Route Handlers, so a route that already holds the household passes `resolveHouseholdLocale(household)` to `getTranslations({ locale, namespace })` instead of calling `getLocale()` (the two shopping-list routes and `loadPantry` do). `request.ts` honours that explicit locale and loads its catalog. next-intl translates with whatever locale the request config returns, so a config that ignored the override would silently fall back to `getLocale()`.
- `global-error-messages.ts` — the one client-side resolver. `src/app/global-error.tsx` replaces the root layout, so it has no `NextIntlClientProvider` and no request. It reads the layout's `<html lang>` while that is still in the DOM, else `navigator.languages`, else English. The app sets no locale cookie. Its five strings (`errors.global`, three `errors.boundary` keys) are copied into the module rather than importing the catalogs, because global error ships in every page's bundle and Turbopack does not tree-shake JSON (~30 KB gzip per page). The colocated test fails when a copy differs from its catalog key, so change the catalog first, then the copy.

### Chrome (Tier 3)

- `next-intl` for UI strings. Catalogs in `messages/en.json` and `messages/et.json`.
- `enum-label.ts` provides `useEnumLabel` (client) for domain-enum rendering — meal types, ingredient categories, dietary types, etc. There is no server-side variant: render enum labels in a client component, or read `enums.<EnumName>.<value>` via `getTranslations` directly at the RSC call site.
- Vague quantity phrases (`MealComponent.originalPhrase`: "to taste", "a pinch") are stored as English matcher keys from `VAGUE_PHRASES` and rendered through `enums.VaguePhrase`: `useVaguePhrase` (client) or `formatVaguePhrase` in `vague-phrase.ts` with a `getTranslations` translator (server; `formatShoppingQuantity` takes one). A phrase outside the vocabulary renders unchanged.
- `format-number.ts`: `formatQuantity` and `formatInteger` — locale-aware decimal separator (`1.5` vs `1,5`).
- `format-dates.ts`: locale-aware weekday / month / relative-date rendering. Always pass the household's locale, never hardcode `en-US`.
- `parse-number.ts`: input-side counterpart to `formatQuantity` — accepts `1,5 kg` from Estonian users and parses to `1.5`.
- `og-locale.ts`: maps app locales to OpenGraph locale strings for per-route metadata.
- ICU MessageFormat plural rules live in the `messages/{en,et}.json` catalogs; `next-intl` resolves them at render time. `src/lib/i18n/plurals.test.tsx` covers the contract.
- `content.ts`: `translateIngredient` and friends — resolves the right display string for translatable content. A locale outside `KNOWN_LOCALES` reads as the default (no join, no overlay), so a caller that skipped `resolveHouseholdLocale` still renders English.
- `manifest.ts` calls `getTranslations('meta.manifest')`, but the browser fetches the manifest without cookies (Next sends credentials on Vercel previews only), so the PWA install description follows Accept-Language, not the household locale.
- **English by design:** the OpenGraph card (`src/app/opengraph-image.tsx`; per-locale cards are a separate investment, see its header comment). `/status`, `/bot`, the manifest and global error read the catalogs (HON-919). The legal pages — `/privacy`, `/terms`, `/privacy/subprocessors` — title, description and prose included, because legal text is maintained in one language, alongside the DPAs and DPIA in `compliance/`; their shared layout sets `lang="en"` on the prose so screen readers switch language (HON-918).

### AI surfaces (Tier 1)

- Every call site in `src/lib/ai/*.ts` accepts a `locale` parameter. The shared `localeInstruction(locale)` in `src/lib/ai/prompts.ts` returns an empty string for the default locale (so English flows are byte-identical to pre-i18n) and for any locale outside `KNOWN_LOCALES`, and an explicit `LOCALE: Produce all user-visible output in <Language>` block otherwise. Routes pass `resolveHouseholdLocale(household)`, never the raw `household.locale`.
- The three surfaces that emit user-visible free text (imagine-meal, recipe parsing, preparation tips) append an Estonian voice block after that: `estonianVoiceForImagineMeal`, `estonianVoiceForRecipeParse`, and `estonianVoiceForPrepSteps`, also in `prompts.ts`. Each carries register rules plus few-shot pairs and returns an empty string for every locale but `et`, and for `et` too once it leaves `KNOWN_LOCALES`. The rules and pairs are distilled from [`AI_VOICE_ET.md`](./AI_VOICE_ET.md), the canonical voice reference; change the doc first, then the helper. Plan generation and quantity review produce no free text and carry only `localeInstruction`.
- No AI surface creates ingredients: imagine-meal and recipe parsing resolve every ingredient to an existing row through the matcher, and anything unmatched goes back to the user. If one ever does, store the row with `householdId = <current household>` in the creator's locale, never in the global pool.
- AI response caches must include `locale` in the key to avoid cross-locale contamination. The one stored cache — `MealPlanEntry.preparationTips` — honours that by invalidation rather than by keying: `PATCH /api/households/me` nulls every entry's tips inside the household-update transaction when the locale changes, and `PATCH /api/meal-plans/[id]/entries/[entryId]` nulls that entry's when its `servingOverride` changes, since the prompt also scales by the effective serving count (HON-681). `PATCH /api/households/me/meals/[id]` does the same for every entry of a meal when an edit _changes_ a field the prompt consumes — `name`, `timeMinutes`, `preparationNotes`, or the component list scaled by `servings` — and deliberately not when it changes only something the prompt never sees, such as `sourceUrl`. It compares against the stored meal rather than testing which fields were sent, because the meal form PATCHes its whole payload on every save (HON-683). A household's **member count** is a further input, because the effective serving count falls back to it whenever an entry carries no `servingOverride` — the default state — so every membership write clears the cache too, via `invalidateFutureEntrySteps` in `src/lib/meal-planning/preparation-steps-cache.ts`: the manual-member add (`POST /api/households/me/members`), the removal (`DELETE /api/households/me/members/[id]`), and the account purge that drops a membership from a household that survives it (`src/lib/auth/purge-user.ts`). That one is bounded to entries dated **today or later** that are not already `completed`, and to entries without an override: tips for a meal already cooked are never read again, so regenerating them would be pure AI spend, and an entry with an override was priced from the override rather than from the member count (HON-684). The `status` clause is what makes the date bound honest — a dinner cooked at 18:00 is still dated today at 20:00 — and it is `not: 'completed'` rather than `'planned'` so a later un-skipped entry does not come back holding tips priced at the old count; leaving `completed` nulls them at the entry PATCH, so skipping defers the invalidation to the revert rather than dropping it. The invite-accept path claims a pre-existing member row instead of creating one, so it leaves the count — and the cache — alone. The count is also re-read in `preparation-tips/route.ts` just before the cache write, alongside the `mealId` / `servingOverride` / `locale` / `meal.updatedAt` filters pinned there: an entry that is mid-generation holds `preparationTips: null`, so no invalidation can reach it, and an unguarded write would put the old household size's tips back permanently.
- After every successful `generateObject` call, `logAiSample` (see [Reviewing AI output quality](#reviewing-ai-output-quality)) emits a structured JSON line for every non-default-locale call and for 5% of English calls (`DEFAULT_LOCALE_SAMPLE_RATE`).

The Estonian recipe-parser surface was gated behind `FEATURE_RECIPE_PARSER_ET` until ingredient translations landed — Estonian input without translation data could not be matched to the English-named global pool. HON-506 seeded an Estonian translation for every global ingredient and **retired that gate**: `src/app/api/recipes/parse/route.ts` now runs the parser in the household's resolved locale (`resolveHouseholdLocale`), and the matcher resolves Estonian ingredient names directly. The env flag no longer exists.

The selector + onboarding-clamp gate (`FEATURE_PUBLIC_LOCALES_FULL`, plus the `effectivePublicLocales` / `isEffectivelyPublicLocale` helpers) was retired in HON-549 alongside the public flip. With `PUBLIC_LOCALES = ['en', 'et']`, the selector in `src/app/household/household/HouseholdSettingsForm.tsx` reads `PUBLIC_LOCALES` directly, and `src/app/api/households/route.ts` persists the `resolveLocale` result without clamping. Removing the env var from Vercel (staging + production) is a manual follow-up tracked in the HON-549 PR.

### Transactional email

Three templates are localized: `src/lib/emails/reset-password.ts` and `src/lib/emails/account-deletion-requested.ts` (HON-513), and `src/lib/emails/breach-notification.ts` (HON-919). All are pure functions taking `{ ..., locale }` and returning `subject` / `html` / `text`, with `<html lang>` set from that locale.

- **Copy** lives in `messages/{en,et}.json` under `emails.<template>`, so `catalogue-parity.test.ts` enforces en/et parity for email strings too.
- **Catalog access** goes through `emailTranslator(locale, namespace)` in `src/lib/emails/i18n.ts`, which wraps `createTranslator` over statically imported catalogs, with the `emails` namespace overlaid on English so a missing key degrades to an English sentence instead of a rendered key path. `getTranslations` is deliberately _not_ used: it resolves the locale via `getRequestConfig` → `getLocale()` → `headers()`, and the Better Auth `sendResetPassword` hook has no guaranteed request scope.
- **Locale resolution** is at the call site, via `resolveEmailLocale(userId)` in `src/lib/emails/locale.ts` — household locale only, validated against `PUBLIC_LOCALES`, falling back to `en` for a user with no household, an unrecognised locale, or a failed lookup. `Accept-Language` is not consulted: it is unavailable in the Better Auth hook, and household locale is the stronger signal anyway.
- **Mixed HTML/plain-text strings** (the bolded purge date, the linked recovery address) use one key with `t.markup`, which returns a string — `t.rich` returns a `ReactNode` and is unusable here.
- **Breach notification** is operator-sent, so the operator resolves each recipient's locale with `resolveEmailLocale` and passes it in. The template localizes its fixed copy only; `summary`, `impact` and `remediation` are free text the operator writes once per locale (see [`RUNBOOKS/breach-notification.md`](RUNBOOKS/breach-notification.md)).

### Form input parsing

`parse-number.ts` handles locale-aware decimal-separator parsing for numeric form inputs (pantry quantities, recipe-create, shopping). Estonian users typing `1,5 kg` get `1.5` parsed; English users typing `1.5 kg` work unchanged. Display formatting (`Intl.NumberFormat` via `formatQuantity`) is the output-side counterpart.

### Tests

- `src/lib/i18n/catalogue-parity.test.ts` (`pnpm test`): `en.json` and `et.json` have the same keys, ICU placeholders and markup tags, and no empty values. Every message parses with `@formatjs/icu-messageformat-parser`. An argument `en` branches on (`plural`, `select`, `selectordinal`) branches the same way in `et`, and every `et` cardinal plural has `one` and `other`. `et` may add a plural where `en` has a plain `{count}`, because Estonian inflects the noun (`meal-plan.serving.labelWithCount`).
- `scripts/check-server-prose.test.ts` (`pnpm test`; `pnpm i18n:prose-check` prints the hits): fails on `toast(…)`, `toast.<method>(…)`, `setError(…)` or `set<Name>Error(…)` called with a caught error's `.message`, with the file and line. The rule and its limits are documented at the top of `scripts/check-server-prose.ts`. There is no allowlist: fix a hit by logging the server string and rendering catalog copy. `src/app/admin/` is out of scope (English operator console).
- `src/lib/i18n/plurals.test.tsx`: plural rendering through the real next-intl.
- `tests/e2e/i18n-smoke.spec.ts` (`@i18n`, every PR): Estonian chrome signed out, and the onboarding locale round-trip.
- `tests/e2e/i18n-full-flow.spec.ts` (`@i18n @ai`, run by hand with `pnpm test:e2e:local`; it makes real Claude calls): an Estonian household from sign-up through plan, meal detail, shopping, pantry and imagine. It asserts the pantry rows on screen without a reload, and searches the meal selector and the pantry inline add by Estonian names.

## Reviewing AI output quality

Every non-default-locale AI call, and 5% of English ones (`DEFAULT_LOCALE_SAMPLE_RATE`), emits a structured `[ai-sample]` JSON line containing the AI input and output (no household / user IDs) and the `sampleRate` it was logged at. This closes the iteration loop for ongoing voice tuning without requiring an admin page or DB table. The English share exists so production inputs can become model-benchmark cases (`--import-sample`, see [AI_MODELS.md → Where cases come from](./AI_MODELS.md#where-cases-come-from)). Implementation: `src/lib/ai/sampling.ts`.

### Locally (`pnpm dev`)

Each sample is appended to `.ai-samples/<YYYY-MM-DD>.jsonl` (gitignored).

```bash
# Watch today's samples live
tail -f .ai-samples/$(date +%Y-%m-%d).jsonl | jq '.'

# Last 20 Estonian meal names produced by imagine-meal
jq -r 'select(.callSite == "imagine-meal" and .locale == "et") | .output.meals[].name' \
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
5. Seed step 4 **before** exposing the new locale. `src/app/api/recipes/parse/route.ts` runs the parser in the household's resolved locale (the `FEATURE_RECIPE_PARSER_ET` gate was retired in HON-506), so a new-locale household reaches the recipe parser immediately — and without seeded `IngredientTranslation` rows the matcher can't resolve names, so every parsed ingredient comes back unmatched — the problem the old gate guarded against. The **selector** reads `PUBLIC_LOCALES` directly today (HON-549 retired the staging-only env-flag override), so the new locale is not offered in household settings until it lands there. **Onboarding is not clamped**, though: `POST /api/households` persists `resolveLocale`'s result as-is (`src/app/api/households/route.ts:63-67`), and `resolveLocale` / `matchAcceptLanguage` (the no-household path onboarding takes) gate on `isKnownLocale`, not `isPublicLocale` — whose only non-test caller is the email-locale lookup (`src/lib/emails/locale.ts`). A browser sending the new locale in `Accept-Language` will therefore be onboarded into it the moment it joins `KNOWN_LOCALES`. Keep it out of `KNOWN_LOCALES` until it is ready, or add the clamp.
6. **RTL languages only:** add a `direction` field to a parallel map, set `<html dir>` from it in `src/app/layout.tsx`, and audit Tailwind direction-sensitive utilities (`mr-`, `ml-`, `pl-`, `pr-` → `me-`, `ms-`, `pe-`, `ps-`). Tracked as deferred — the codebase currently assumes LTR.
7. Pilot-test with a target user before adding to `PUBLIC_LOCALES`. **Estonian did not pass this step.** It joined `PUBLIC_LOCALES` in HON-549 without a pilot test, and its partner test (HON-512) was cancelled on 2026-09-30. That was accepted (HON-873) because sign-up is invite-only (`invite_code_required`), so the people who see unreviewed Estonian are few and known. The native-speaker copy review (HON-536) is scheduled and is the only language-quality check on Estonian. Do not take Estonian as precedent: the step stays the rule for the next locale.
8. Add to `PUBLIC_LOCALES` to expose in the locale selector. Before flipping public, add the locale's copy to the `emails` namespace in `messages/<locale>.json`. `emailTranslator` overlays the locale's `emails` namespace on English, so a key the new catalog is missing degrades to an English sentence rather than to next-intl's default fallback (the literal key path — `emails.resetPassword.cta` in a CTA button). That overlay is a floor, not a safety net: a key that is _present_ but whose ICU syntax is malformed still renders the key path, and `catalogue-parity.test.ts` compares `en.json` against `et.json` by name, so extend it to the new catalog rather than assuming it is covered. See [Transactional email](#transactional-email).

## Adding a new AI call site

Any new `generateObject` (or equivalent) call must:

1. Accept `locale: string` (or `locale?: string`) and pass it into prompt construction via `localeInstruction(locale)` from `src/lib/ai/prompts.ts`.
2. Include `locale` in any caching key for the AI response.
3. After a successful call, invoke `logAiSample({ callSite, locale, input, output })`. Keep `input` to AI-visible context only (no IDs). Add the call site name to the `AiSampleCallSite` union in `src/lib/ai/sampling.ts`.
4. If the call site lives outside `src/lib/ai/`, add the same locale-threading test (English vs Estonian prompt assertion) plus a sampling-helper-was-invoked test.
5. No call site creates `Ingredient` rows today. One that does must scope them to `householdId = <current>` in the creator's locale — never insert into the global pool.

Two existing calls are exempt from steps 1–4 because neither produces text a household reads: the meal-image judge in `src/lib/meal-images/generate.ts` returns structured checks the code uses to accept or retry an image, and `probeAi` in `src/lib/status/probes.ts` asks for a fixed `{ "ok": true }` to prove the pipeline is reachable.

## Out of scope

Architectural decisions that the platform supports but we deliberately don't ship:

- **Multi-household switching** within a single user account.
- **User-level locale override** within a household. Household locale is the unit.
- **Cultural adaptation** — no locale-specific meal swaps or ingredient substitutions. Same row, different display name.
- **Automated AI quality scoring** (LLM-as-judge). Sampling exists for human review, not synthetic grading.
- **Mid-lifetime locale-change UX** (visual markers, on-demand translation, switch-time prompts). Silent mixed state by design.
- **PostHog locale tagging** (HON-516, cancelled 2026-09-15). Not wired and not planned; errors and analytics carry no locale. There is no Sentry — PostHog is the error tracker.
- **Full English AI output sampling.** English output is not voice-reviewed; `logAiSample` keeps 5% of English calls, for benchmark cases only (HON-903).

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
- HON-512 — partner test (cancelled 2026-09-30; see [Adding a new locale](#adding-a-new-locale) step 7).
- HON-513 — transactional email localization (password reset, account deletion).
- HON-514 — admin promotion of household-scoped ingredients to the global pool (cancelled 2026-09-15). No promotion path replaces it, and none is planned before public sign-up opens (see [Decided principles](#decided-principles)).
- HON-515 — input-side decimal-separator parsing.
- HON-516 — PostHog locale tagging (cancelled 2026-09-15).
- HON-517 — post-launch translation maintenance workflow.
- HON-536 — native-speaker copy review of the whole app, scheduled; split into HON-883 (screens and emails), HON-884 (AI-generated text) and HON-885 (ingredient names). It absorbed HON-548, the ingredient native-variant review.
- HON-873 — the 2026-09-30 decisions on the Estonian pilot test and the global ingredient pool.
