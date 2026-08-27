---
name: audit-ingredients
description: Audit ingredient database for coverage gaps, matching issues, and nutritional/allergen data quality
argument-hint: '[--focus coverage|data-quality|all]'
context: fork
allowed-tools:
  - Bash
  - Read
  - Grep
  - Glob
---

# Ingredient Database Audit

Audit the ingredient database for coverage gaps, matching quality, and nutritional/allergen data accuracy. Uses two scripts that run checks programmatically against the real database.

## Scripts

| Script | What it checks | DB required |
|--------|---------------|-------------|
| `scripts/audit-ingredients/audit-data-quality.ts` | Nutrition consistency, allergen correctness, alias validity, duplicates | Yes |
| `scripts/audit-ingredients/audit-coverage.ts` | Missing ingredients, matching quality, trigram fuzzy search accuracy | Yes |

## Arguments

- `--focus coverage` — Run only the coverage audit (generate ingredient names + test matching)
- `--focus data-quality` — Run only the data quality audit (nutrition + allergens + aliases)
- `--focus all` — Run both (coverage + data-quality); identical to passing no arguments
- No arguments — Run both

## Phase 1: Data Quality Audit

### Step 1: Run the data quality script

```bash
npx tsx scripts/audit-ingredients/audit-data-quality.ts 2>/tmp/audit-data-quality.log > /tmp/audit-data-quality.json
echo "exit=$?"
```

Check the exit status before reading the JSON. On failure the script prints `Audit failed: …` to stderr (now in `/tmp/audit-data-quality.log` — typically a missing `DATABASE_URL` or a connection error) and the JSON file is empty or partial; stop and report the log contents instead of interpreting an empty report. On exit 0, read `/tmp/audit-data-quality.json`.

The script queries all ingredients from the database and checks:

**Nutrition:**
- All-zero entries (placeholder data)
- Protein items with 0 protein, fat items with 0 fat
- Calorie-macro consistency (`protein×4 + carbs×4 + fat×9 ≈ calories`)
- Macros exceeding 100g per 100g
- Negative values
- Category outliers (vegetable > 200 kcal, etc.)
- Piece-based items missing `gramsPerPiece`

**Allergens:**
- Dairy items missing `dairy` tag (with exceptions for plant-based)
- Fish/shellfish items missing `fish`/`shellfish`
- Nut items missing `nuts` (with coconut/peanut exceptions)
- Soy items missing `soy`, sesame items missing `sesame`
- Egg items missing `eggs` (including egg-based pastas)
- Gluten items missing `gluten` (with GF grain exceptions)
- False positive allergen tags (plant-based with `dairy`, rice with `gluten`, etc.)

**Aliases:**
- Alias targets that don't exist in the database
- Ingredients that probably need aliases but don't have them

**Duplicates:**
- Ingredient names appearing more than once

### Step 2: Interpret the data quality report

Read the JSON output. It contains:
- `totalIngredients` — count of all ingredients in DB
- `findings` — array of issues, each with `severity`, `area`, `ingredient`, `issue`, `details`
- `summary` — counts by severity and area

Present findings grouped by severity (critical → warning → info), then by area.

**For critical allergen findings:** These are safety issues. Emphasize that a missing allergen tag could serve unsafe meals to allergic users. Put the exact seed-file change at the top of the Step 7 fix list.

**For nutrition findings:** Note which seed file the ingredient is in (use Grep across `prisma/seed*.ts` to locate it) and add the corrected values to the Step 7 fix list.

---

## Phase 2: Coverage Audit

### Step 3: Generate test ingredient names

Generate a comprehensive list of ingredient names that the AI Imagine feature would commonly produce. Write them to `/tmp/audit-ingredient-names.txt`, one per line.

**Cuisines to cover** (generate ~20-25 ingredients per cuisine, focusing on cuisine-specific items that may be missing):
- Japanese, Korean, Thai, Vietnamese, Chinese
- Indian, Middle Eastern, Ethiopian
- Mediterranean, Italian, French, Greek
- Mexican, Caribbean, Brazilian
- American, British, Nordic
- West African

**For each cuisine**, focus on:
- Proteins (specific cuts: "chicken katsu", "beef bulgogi")
- Cuisine-specific vegetables ("daikon", "bok choy", "tomatillo")
- Key condiments and sauces ("gochujang", "fish sauce", "tahini")
- Starches ("jasmine rice", "soba noodles", "injera")
- Herbs and spices ("Thai basil", "za'atar", "epazote")
- Dairy ("paneer", "labneh", "queso fresco")

**Also add a "matching edge cases" section** (~30 items) to test the matching pipeline:
- Modifier variations: "fresh basil", "dried oregano", "boneless chicken thigh"
- Regional names: "aubergine", "courgette", "capsicum", "rocket", "coriander"
- Plurals: "tomatoes", "potatoes", "eggs", "bay leaves"
- Generic terms: "chicken", "rice", "pasta", "cheese", "oil"
- Dangerous false matches: "baking powder", "coconut milk", "rice vinegar", "fish sauce", "sesame oil"

**Target:** ~400-500 unique ingredient names after deduplication.

**Important:** Deduplicate the list before writing. Common pantry items (garlic, olive oil, soy sauce, etc.) appear across many cuisines — list each name only once. The script also deduplicates internally, but a clean input file avoids wasted output.

Lines starting with `#` are treated as comments (for section headers).

### Step 4: Run the coverage script

```bash
npx tsx scripts/audit-ingredients/audit-coverage.ts --file=/tmp/audit-ingredient-names.txt 2>/tmp/audit-coverage.log > /tmp/audit-coverage.json
```

Then read `/tmp/audit-coverage.json`. Progress output is in `/tmp/audit-coverage.log`.

The script tests each ingredient name through the real matching pipeline:
1. Exact name match in DB
2. Alias expansion → check
3. Normalization (strip modifiers, singularize) → check
4. Trigram fuzzy search (real PostgreSQL `similarity()` function)
5. Last-word fallback (only if no match above 0.55)

Each ingredient is classified:
- **exact** — Found by exact name
- **alias** — Found via alias expansion
- **fuzzy-high** — Fuzzy match ≥ 0.6 similarity (user would see correct match)
- **fuzzy-low** — Fuzzy match 0.55-0.6 (user would see low-confidence match with alternatives)
- **unmatched** — No match found (ingredient missing from DB)

Progress is logged to stderr. JSON report goes to stdout.

### Step 5: Interpret the coverage report

Read the JSON output. Key sections:
- `summary` — counts by match status
- `unmatchedList` — ingredients with no match at all
- `lowConfidenceList` — ingredients that match but poorly (risky)
- `results` — full details including all match attempts and similarity scores

**Present findings as:**

1. **Unmatched ingredients** — grouped by category (proteins, dairy, produce, grains, condiments, herbs, nuts, other). These need to be added to the seed files.

2. **Low-confidence matches** — review those with `nounMismatch: true`. This flag means the input has words not present in the match, which can indicate:
   - **Wrong species/type** (e.g., "trout fillet" → "cod fillet") — needs the ingredient added to DB
   - **Unstripped modifier** (e.g., "bone-in chicken thigh" → "chicken thigh") — match is correct, normalization could be improved

   Check each case manually before classifying as a coverage gap vs. a matching issue.

3. **Coverage statistics** — overall match rate, breakdown by status.

---

## Phase 3: Report & Action

### Step 6: Compile combined report

```
## Ingredient Database Audit Report

**Date:** [current date]
**Ingredients in DB:** [count]

### Summary

| Area | Status | Findings |
|------|--------|----------|
| Nutrition | [pass/warn/fail] | [counts] |
| Allergens | [pass/warn/fail] | [counts] |
| Aliases | [pass/warn/fail] | [counts] |
| Coverage | [pass/warn/fail] | [X unmatched, Y low-confidence out of Z tested] |

### Critical Issues (fix immediately)
[allergen safety issues, broken aliases]

### Coverage Gaps
[unmatched ingredients by category]

### Data Quality Warnings
[nutrition mismatches, missing unit data]

### Suggested Fixes
[specific changes to seed files, aliases, etc.]
```

### Step 7: Emit actionable output

This skill runs as a fork (`context: fork`): it cannot edit files, create Linear issues, or ask the caller a question. Never "offer" to do any of these — end the report with the two paste-ready blocks below so the caller (or the user) can apply them verbatim.

**7a. Fix list** — one entry per finding that has a concrete code fix, grouped by file. Locate the seed file with Grep (`grep -rn '"<ingredient name>"' prisma/seed*.ts src/lib/ingredient-aliases.ts`) and state the exact before → after change. Order: critical allergen fixes first, then nutrition, then aliases. An entry the caller cannot apply without further investigation is not done.

```
### Fix list

#### prisma/seed-comprehensive.ts
- `prawns`: allergens `['fish']` → `['fish', 'shellfish']` — critical, missing shellfish tag
- `chicken breast`: `calories: 0` → `calories: 165` (protein 31 / carbs 0 / fat 3.6 per 100g)
- `egg`: add `gramsPerPiece: 50` — piece-based item missing per-piece weight

#### src/lib/ingredient-aliases.ts
- add `'courgette': 'zucchini'` — regional name, currently unmatched
- remove `'x': 'y'` — alias target `y` does not exist in the DB
```

**7b. Linear issue drafts** — for work that is not a one-line fix (coverage gaps, matching-pipeline improvements, systematic nutrition problems), emit one draft per category in "Writing for Agents" format (see CLAUDE.md). Use **one issue per ingredient category** (proteins, dairy, produce, grains, condiments, herbs, nuts, other) rather than one bulk issue, so each resulting PR stays small and reviewable. Reference related issues as plain text (`HON-NNN`), never as `<issue id>` tags.

```
### Proposed Linear issues

#### 1. Add missing <category> ingredients to seed data
**Label:** Tech
**What:** Add the following N ingredients to `prisma/seed-expansion.ts` with nutrition per 100g, allergen tags, and `gramsPerPiece` for piece-based items: <comma-separated list>.
**Why:** These names are commonly produced by AI Imagine for <cuisines> and currently classify as `unmatched`, so users fall back to manual ingredient entry. Related: HON-NNN.
**Acceptance criteria:**
- Each listed ingredient resolves as `exact` or `alias` when run through `scripts/audit-ingredients/audit-coverage.ts`
- Allergen tags set for every added item containing dairy / fish / shellfish / nuts / soy / sesame / eggs / gluten
- `scripts/audit-ingredients/audit-data-quality.ts` reports no new findings for the added rows
```

The caller creates the issues and applies the fixes; this skill only drafts them.

### Step 8: Completion marker

```
[audit-ingredients:complete] Audit finished — X coverage gaps, Y data quality issues (Z critical)
```
