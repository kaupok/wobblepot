# Worst-case catalog

Realistic values that break UI, grouped by the kind of value a component renders. Use the rows that apply to the fields in your Phase 1 table. Each value is one a real household could type, paste, import, or get from the AI; the note says what it tends to break.

Adapted from Emil Kowalski's `break-ui` catalog (`emilkowalski/skills`). The first two sections are this app's own. The app ships in English and Estonian only, so right-to-left rows are left out.

Use `example.com`, `example.org` or `.test` domains for emails and URLs, so a fixture never points at a real inbox or site.

---

## Estonian

Estonian builds long words by compounding, and its UI copy often runs longer than the English. Run the `WorstCase` story with `globals: { locale: 'et' }`.

| Value                                                     | Breaks                                                                                                |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `Köögiviljapuljongikuubik`                                | 24 letters, no break point; overflows a shopping row or a chip at 320px                              |
| `Kanafileekastmega ahjukartulid`                          | A compound longer than the narrow column; the line breaks only at the one space                       |
| `Rabarberi-maasikakook`                                   | The hyphen is the only break point, so a line can end on "Rabarberi-"                                 |
| `Õunakook`, `Ülle`                                        | A capital `Õ` or `Ü` is taller than a capital `O`; clipped by a tight line height with `overflow-hidden` |
| `1,5 dl`, `0,25 tl`, `2 ½ sl`                             | The decimal comma; `parseFloat('1,5')` is `1`, and a raw `1.5` reads wrong in Estonian                |
| `neljapäev`, `laupäev, 14. märts`                         | Weekday and date names are longer than `Thu` or `Sat, Mar 14`; date chips and day headings overflow   |
| Estonian button and badge labels                          | Often longer than the English; compare the `en.json` and `et.json` values and test the longer one     |
| 1, 2 and 21 of a counted noun (`1 portsjon`, `2 portsjonit`) | Plural forms: an ICU `one` branch missing in one catalog                                           |

## Meals, plans and households

Look up each limit in the schema before you use the number here; these were the limits when this file was written.

| Value                                                                                 | Breaks                                                                                         |
| ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| A 200-character meal name (the form's `maxLength`), such as a pasted blog title: `Grandma's slow-cooked beef and mushroom stew with root vegetables, fresh thyme and a red wine sauce (freezer-friendly, makes leftovers for two lunches)` | The planner card title, the meal selector row, the shopping "for" line |
| `Pho`, `Öö` (two letters)                                                              | A card that assumed a long title looks empty; a short name as the only tap target               |
| `🍝 Spaghetti bolognese`                                                               | Emoji first; `.charAt(0)` returns half a surrogate pair; sorting and search                     |
| `Mac & cheese`, `Fish <and> chips`                                                    | Escaping: must render as literal text                                                           |
| Two household recipes with the same name                                              | A list where the name is the only thing that tells them apart                                   |
| A 1,000-character description                                                         | Card previews without a clamp, the detail view's line length                                    |
| A 200-character note with no spaces (a pasted URL)                                    | The sticky note's two-line clamp; an unbreakable line in the editor                             |
| A meal with no image, an image still `generating`, and one with no `imageHue`         | The three image states in DESIGN.md → Absence renders the neutral card                         |
| A recipe with 30 ingredients and 25 steps                                             | The cook view's length, the ingredient list's columns                                           |
| An ingredient line `12 × 400 g purustatud tomatid konservis`                           | Quantity, unit and name on one line at 320px                                                    |
| Servings `1` and `12`                                                                 | Plurals; a stepper whose width changes between one and two digits                              |
| A day with breakfast, lunch, dinner, a snack and three extras                         | The tallest day column; the "+ Add" menu with nothing left to add                               |
| A week with nothing planned                                                           | The empty planner                                                                               |
| A 60-item shopping list across every aisle, half of it checked                        | Scroll length, the checked group, the aisle headings                                            |
| A household member named `Mari-Liis Õunapuu-Kärner`, one named `J`                    | Member chips, rules and preference rows                                                         |
| Twelve dietary rules on one member                                                    | A chip row that wraps into a wall; needs a `+8` overflow or a list                              |
| A household of 10 people                                                              | Member lists, serving defaults                                                                  |

## Text from data

| Value                                                         | Breaks                                                                     |
| ------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `Aleksandra Wiśniewska-Kowalczyk`                              | Long, hyphenated, diacritics; wraps to two lines at the hyphen             |
| `Christopher Alexander Montgomery III`                         | Long, with a suffix                                                        |
| `Đặng Thị Ngọc Hân`                                            | Stacked diacritics; clipped by a tight line height                         |
| `王秀英`                                                        | No spaces; CJK breaks anywhere                                             |
| `  Sam   Lee `                                                 | Leading, trailing and repeated spaces; odd gaps, failed matches            |
| `👩🏽‍💻 Priya`                                                    | A ZWJ emoji sequence; `.length` is 7 or more, and slicing breaks it        |
| Empty string, or only spaces                                   | A collapsed heading, a zero-height row                                     |
| `Line one` + newline + `Line two` in a one-line field          | Doubles the row height, or the newline is dropped                          |
| `<script>alert(1)</script>`, `&amp;`, `**bold**`               | Escaping: must render as literal text                                      |
| A 2,000-character pasted text                                  | Clamps, "show more", textarea growth                                       |

## Emails, URLs, identifiers

These have no spaces, so the browser has nowhere to wrap them.

| Value                                                                                         | Breaks                                                               |
| --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `bartholomew.fitzgerald@northwind-industries-holdings.example.com`                             | Pushes every sibling off the row without `wrap-anywhere`            |
| `a@b.co`                                                                                       | A layout that assumed a long email looks empty                       |
| `first.last+meal-planning@example.com`                                                         | Plus-addressing: validation that rejects `+`                         |
| `https://example.com/recipes/2024/11/grandmas-slow-cooked-beef-stew?utm_source=newsletter&ref=x` | A pasted recipe URL; end truncation hides the part that differs     |
| `9f8e7d6c-5b4a-4c3d-8e2f-1a0b9c8d7e6f`                                                         | An ID shown raw; middle truncation, if it shows at all              |

## Numbers

| Value                    | Breaks                                                                       |
| ------------------------ | ---------------------------------------------------------------------------- |
| `0`                      | Zero states: "0 meals", an empty bar, a division by zero in a percentage    |
| `1`                      | Plurals                                                                      |
| `1284`                   | Needs a separator: `1,284` in English, `1 284` in Estonian                   |
| `0.1 + 0.2`              | `0.30000000000000004` rendered raw                                           |
| `142%`                   | A nutrition bar past its end                                                 |
| `null`, `undefined`, `NaN` | Rendered as text                                                           |
| A value that changes live (`9` → `10`) | A width jump without `tabular-nums`                            |

## Collections

| Value                                  | Breaks                                                       |
| -------------------------------------- | ------------------------------------------------------------ |
| 0 items                                | The empty state, and whether one exists                      |
| 1 item                                 | A grid that looks broken with one card                       |
| Exactly a page, and a page plus 1      | Off-by-one in "Showing 20 of 20", an empty second page       |
| The realistic maximum                  | Scroll performance, render time                              |
| One item ten times taller than the others | Grid rows stretched to the tallest item                   |

## Time

| Value                                     | Breaks                                                                   |
| ----------------------------------------- | ------------------------------------------------------------------------ |
| Now                                       | "0 seconds ago" instead of "just now"                                    |
| 12 days, 11 months, 3 years ago           | Relative-time thresholds                                                 |
| A future date                             | "in 3 days" against "-3 days ago"                                        |
| `2026-03-29T23:30:00Z`                    | Another day in Tallinn (UTC+3 in summer) than in UTC; the plan shows it on the wrong day |
| The week that crosses a month or a year   | Week headings, "this week" logic                                         |

Format with `src/lib/i18n/format-dates.ts` in the household's locale, not with hand-built strings.

## Images

| Value                           | Breaks                                                       |
| ------------------------------- | ------------------------------------------------------------ |
| An image URL that 404s          | A broken-image icon instead of the neutral card              |
| A 4000×200 panorama             | Distortion without `object-cover`                            |
| A 200×4000 tall image           | The same on the other axis; can stretch a card               |
| A slow image                    | Layout shift without a fixed `aspect-ratio`                  |

## States

| Value                    | Breaks                                                                                     |
| ------------------------ | ------------------------------------------------------------------------------------------ |
| Loading                  | A skeleton that does not match the final layout, so content jumps                         |
| An API error             | No error state, or the server's English `error` text shown (CLAUDE.md → Localization)      |
| Partial data             | Some optional fields set, others not, in one list; rows that do not line up                |
| Every enum value at once | Badge widths vary across one list                                                         |
| Read-only access         | Disabled actions; does the row keep its layout?                                            |

## Environment

Not data, but checked the same way: show the worst case, then change these.

| Condition                         | Breaks                                                         |
| --------------------------------- | -------------------------------------------------------------- |
| 320px                             | Every overflow above, at once                                  |
| A narrow column (a planner day)   | A component built full-width, reused in a narrow column        |
| 1280px and wider                  | Lines too long to read, content left stranded on one side      |
| Root font size at 200%            | Fixed heights that clip growing text                           |
| Dark mode                         | Hard-coded colours, borders that disappear, images on dark     |
| Touch                             | Actions that only show on hover cannot be reached              |
