# Benchmark cases

One JSON file per case, in `<task>/<slug>.json`. The case's id is `<task>/<slug>`. Each file is validated against its task's schema in [`../case-schema.ts`](../case-schema.ts), which is strict: a key the schema does not name fails the load. Where cases come from, and when to add one, is in [docs/AI_MODELS.md → Where cases come from](../../../docs/AI_MODELS.md#where-cases-come-from).

A slug starts with the locale (`en-`, `et-`) and names what the case is about (`en-shellfish-allergy-paella`), not when it was added.

## `source`

Every task takes an optional `source`, which says why the case exists:

- **An issue ID** (`"source": "HON-895"`): the case reproduces that issue's AI output bug, and was added with or before the fix.
- **`"ai-sample"`**: the case started as a production sample, imported with `--import-sample`.
- **Omitted**: a synthetic case written for coverage.

Nothing scores it, and the judge never sees it: a judge told a case is a known failure would look for one.

## Drafts (`.draft.json`)

```bash
pnpm ai-eval --import-sample sample.log --id imagine/en-pasta-for-two
```

This turns one `[ai-sample]` line from the Vercel logs or `.ai-samples/*.jsonl` into `imagine/en-pasta-for-two.draft.json`. The draft has the input fields the sample carried, every expectation field present but empty, and the sample's own `sampleInput` and `sampleOutput` for reference. The command prints the fields the sample could not fill, since every call site logs less than a case needs. A plan sample has only the pool sizes, and a tips sample has only the ingredient count.

`fill-empty-slots` samples are refused, because `fillEmptySlots` is out of the benchmark's scope.

A draft is never loaded, and it is gitignored, because it holds a real household's words. It can include their allergens, which are health data. The privacy policy tells users that runtime logs are kept for 1 day, and the sample file and the draft are copies of a log line. So delete the sample file as soon as the draft is written, and finish or delete the draft the same day. To finish one:

1. Fill in what the command listed as missing, and write the expectation (below).
2. Rewrite the user's text as synthetic text with the same shape: the request, the constraint or the quirk that made the sample worth keeping. A committed case never holds a real user's words.
3. Delete `sampleInput` and `sampleOutput`. The strict schema fails a case that still has them.
4. Rename `<slug>.draft.json` to `<slug>.json` and run `pnpm vitest run scripts/model-bench` to validate it.

Delete a draft you decide not to finish.

A finished draft still has `"source": "ai-sample"`, unless the case reproduces a bug; then it takes the issue ID instead.

## Writing the expectation

### plan

There is none. Every plan is scored on structure, first-try validity, validity after repair, out-of-pool meal IDs and protein variety. What a case controls is the input: the dates, the meal types on weekdays and at weekends, the diet, and the candidate pools. A plan case offers 20 to 50 dinner candidates in total, and a meal ID never names two meals.

### recipe

`expected.ingredients` lists every ingredient the parser should find. Write the names in the **output** language: an Estonian case expects Estonian names. Each `names` array holds the aliases that count as a match:

```json
{ "names": ["garlic", "garlic clove", "garlic cloves"], "quantity": 2, "unit": "piece" }
```

`quantity` and `unit` are what the recipe states, or `null` for "to taste". `lowConfidence` is `true` only for text the app should reject as not a recipe, such as a restaurant review. That is the one case where `ingredients` may be empty. `stepCount` is optional and only reported, never scored.

### imagine

The household's allergens and dietary type are covered by the shared lists in `src/lib/ai/forbidden-foods.ts`, which the production guard uses too. Do not repeat them. `forbiddenKeywords` is for what those lists cannot know:

- **Do** list the household's `excludedIngredients` (`"chorizo"`) and a food the shared lists lack for this case.
- **Don't** list a food every household with that allergen or diet must avoid (`"shrimp"` for a shellfish allergy). Add it to the shared list instead, so the guard catches it too.
- **Don't** list a word that is part of safe ingredient names unless `allowedQualifiers` excuses them. `"egg"` matches "eggplant", so a case forbidding egg lists `"eggplant"` as a qualifier.

`imagine/en-shellfish-allergy-paella.json`:

```json
{
  "prompt": "a seafood paella for a summer weekend",
  "household": {
    "allergens": ["shellfish"],
    "dietaryType": null,
    "excludedIngredients": ["chorizo"],
    "restrictions": [],
    "householdSize": 3
  },
  "locale": "en",
  "forbiddenKeywords": ["chorizo"],
  "source": "HON-895"
}
```

Delete `forbiddenKeywords` and `allowedQualifiers` from a draft that needs neither.

### review

The input seeds errors into otherwise sensible quantities. `expected` is keyed by `ingredientId` and has one of three forms for each ingredient:

- A **range** for a seeded error the review prompt's reference table covers. Copy the table's range, so an answer at either end passes: `"ing-beef": { "min": 100, "max": 200 }`.
- A **single value** for a seeded error the table does not cover. It is accepted within ±25%: `"ing-cheddar": { "quantityPerServing": 30 }`.
- **`{ "unchanged": true }`** for a correct quantity the review must leave exactly as it is.

Give every ingredient an entry, so a correct quantity that the model "fixes" is caught. Quantities are per serving, in the ingredient's own unit (`g` or `piece`).

### tips

There is no expectation field. Tips are scored on whether the item counts fall within the ranges the prompt asks for, and by the judge. What `kind` decides is the request:

- **`full`**: the app writes the whole preparation guide (equipment, steps and pitfalls) from the meal and its components.
- **`supplementary`**: the user has written their own `preparationNotes`, and the app adds pitfalls and one tip on top of them. A supplementary case must have notes, and the notes are what the case tests: write ones a good answer should not repeat.
