# Estonian AI voice reference

The canonical voice for every Estonian string the AI produces at runtime: imagined meals, parsed recipes, and preparation tips. Tier 1 in [LOCALIZATION.md](./LOCALIZATION.md)'s three-tier model. Chrome translators (Tier 3) use the [case inflection](#case-inflection-and-compound-strings) section as the rule for when to reword a template rather than parameterize it.

The bar: **the partner reads it and does not notice it was written by a machine, or translated.** Not "grammatically correct Estonian." Correct-but-translated is the failure mode this document exists to prevent.

The seeded meal translations in `prisma/seed-meal-translations-et.ts` (HON-507) are the ground truth for naming and description register. When the AI's output and the seed disagree in style, the seed wins; fix the prompt, not the seed.

## Register

Casual, warm, `sina`-form. Culinary, not pretentious. The reader is a tired parent at 17:00 with a two-year-old on one hip, not a cookbook reader.

- **`sina`, never `teie`.** The app already addresses the user as `sina` in chrome. A `teie`-form prep step ("Kuumutage ahi") reads like a school cafeteria notice.
- **Present tense, active voice.** "Pannil praetud kana riisiga", not "Kana praeti pannil ja serveeriti riisiga".
- **Plain kitchen words.** `prae`, `keeda`, `hauta`, `sega`, `haki`, `lõika`, `küpseta`. Not `termiliselt töötle`, `valmista ette`, `serveerimiseks vormista`.
- **No marketing filler.** Never `tervislik`, `tasakaalustatud`, `maitsev`, `suurepärane`, `ideaalne` as a stand-alone claim. Say what the dish _is_; the reader decides whether it sounds good.
- **No padding.** Estonian has no polite-filler obligation. `Palun`, `nüüd on aeg`, `ärge unustage` are noise in a step list.
- **A light touch is welcome, constant whimsy is not.** One warm phrase per description at most ("mis meeldib ka lastele"). Matches the brand voice in [PROJECT_SPEC.md → Brand voice and tone](./PROJECT_SPEC.md#brand-voice-and-tone).

| Bad                                                        | Good                                           | Rule broken       |
| ---------------------------------------------------------- | ---------------------------------------------- | ----------------- |
| Kuumutage ahi 200 kraadini.                                | Kuumuta ahi 200 °C-ni.                         | `teie`-form       |
| Kana praeti pannil ja serveeriti riisiga.                  | Pannil praetud kana riisiga.                   | passive, past     |
| Töötle köögiviljad termiliselt ja vormista serveerimiseks. | Prae köögiviljad ja tõsta taldrikule.          | pretentious verbs |
| Tervislik, tasakaalustatud ja väga maitsev õhtusöök.       | Kiire argipäeva õhtusöök, mis meeldib lastele. | marketing filler  |
| Palun ärge unustage, et nüüd on aeg lisada riis.           | Lisa riis.                                     | padding           |

## Meal naming

Names are what the partner sees in the plan grid and on the shopping list header. Idiomatic short forms over literal translations. Rules, then pairs.

- **Compound nouns are the Estonian default.** `Kanakarri`, `Kõrvitsasupp`, `Tofukarri`, `Kodujuustukauss`. The first part takes the genitive: `sibulasupp` (not `sibulsupp`), `kartulisalat`, `seenerisotto`. Hyphenate only when both parts are long or the compound would be unreadable: `Sidruni-kanasupp`, `Mesi-küüslaugu kanakoivad`.
- **"X with Y" is the comitative, not `koos`.** `Ahjulõhe sparglitega`, `Tursk köögiviljadega`, `Veiseliha brokoliga`. Never `Lõhe koos spargliga`.
- **`ahju-` replaces "baked / roasted / oven / sheet pan".** `Ahjukana`, `Ahjulõhe`, `Ahjukartulid`, `Ahjukanakoivad kartulitega`. Drop the appliance from the name; the prep steps carry it.
- **Drop English method-words that Estonian menus do not use.** "Slow cooker", "one-pot", "sheet pan", "skillet" are not part of the dish. `Veiselihahautis`, not `Aeglase pliidi veiselihahautis`.
- **Keep international dish names.** `Ratatouille`, `Pad Thai`, `Spaghetti Bolognese`, `stroganoff`, `teriyaki`, `wok`. Estonian borrows them as-is and inflects the borrowed word: `Veiseliha stroganoff`, `Lõhe teriyaki`, `Krevetid wokis`.
- **Sentence case.** Capitalise the first word and proper nouns only. `Kana Caesari salat` (Caesar is a name), `Kreeka kanakauss`, `Tai basiilikukana`. Never `Kreemjas Küüslaugu Kana Pasta`.
- **Short.** Two to four words. The English source often lists every component; the Estonian name picks the two that identify the dish.

| English source                | Bad (calque)                                | Good                       |
| ----------------------------- | ------------------------------------------- | -------------------------- |
| Chicken Rice Bowl             | Kana-riisikauss                             | Kanariis                   |
| Creamy Garlic Chicken Pasta   | Kreemjas küüslaugu-kana pasta               | Kanapasta küüslaugukastmes |
| Baked Salmon with Asparagus   | Ahjus küpsetatud lõhefilee koos sparglitega | Ahjulõhe sparglitega       |
| Slow Cooker Beef Stew         | Aeglase pliidi veiselihahautis              | Veiselihahautis            |
| Sheet Pan Chicken and Veggies | Küpsetusplaadi kana ja köögiviljad          | Ahjukana köögiviljadega    |
| Grilled Cheese Sandwich       | Grillitud juustu võileib                    | Kuum juustuvõileib         |
| Shepherd's Pie                | Karjase pirukas                             | Karjusepirukas             |
| Butternut Squash Soup         | Muskaatkõrvitsa supp                        | Kõrvitsasupp               |
| Mushroom Risotto              | Seenerisoto                                 | Seenerisotto               |
| Honey Garlic Chicken          | Mesi küüslauk kana                          | Mesi-küüslaugu kanakoivad  |

## Description voice

One or two sentences, present tense, appetising. Describe what is on the plate and one thing about how it got there. No instructions, no nutrition claims, no adjectives that could describe any dish.

- **Lead with the main component in the form it is served.** `Mahlane kanafilee`, `Ahjus küpsenud lõhe`, `Pannil praetud steik`.
- **Texture and method words do the work.** `krõbe`, `mahlane`, `kreemjas`, `kuldne`, `pehme`, `värske`, `röstitud`, `hautatud`. These are appetising; `tervislik` is not.
- **No clinical vocabulary.** `sisaldab`, `valgurikas`, `süsivesikud`, `kalorid`, `toitained` do not belong in a description.
- **No instructions.** Temperatures, times, and steps go in the prep notes.
- **One warm turn of phrase at most.** "mis meeldib ka lastele", "argipäeva kiire õhtusöök", "pühapäevane".

| Bad                                                                     | Good                                                                        |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| See roog sisaldab kanafileed, riisi ja köögivilju ning on valgurikas.   | Mahlane kanafilee aurutatud riisi ja krõmpsuvate köögiviljadega.            |
| Toit valmistatakse ahjus 200 kraadi juures 25 minuti jooksul.           | Ahjus küpsenud lõhe, mis jääb seest mahlane, ja sidruniga röstitud spargel. |
| Tervislik ja tasakaalustatud eine kogu perele.                          | Kiire argipäeva õhtusöök, mis meeldib ka lastele.                           |
| Kreemjas pasta kanaga, mis on väga maitsev.                             | Kreemjas pasta grillitud kana ja parmesaniga.                               |
| Traditsiooniline roog, mis on valmistatud hakklihast ja kartulipüreest. | Hakklihakaste kartulipüree all, ahjus kuldseks küpsenud.                    |
| Kana praeti pannil ja serveeriti riisiga.                               | Pannil praetud kana riisiga.                                                |
| Maitsev supp, mis sobib ideaalselt külmaks talveõhtuks.                 | Paks kõrvitsasupp ingveri ja kookospiimaga.                                 |

## Prep-note voice

Imperative `sina`-form, one action per step, no padding. This voice applies to parsed-recipe `preparationNotes`, prep-tip `steps`, `pitfalls`, `tip`, and `equipment`.

- **Start every step with the verb.** `Kuumuta`, `Haki`, `Prae`, `Lisa`, `Sega`, `Keeda`, `Küpseta`, `Serveeri`.
- **Never `teie`-form, never `tuleb` / `tuleks` / `peaks`.** "Kana tuleb pannil kuldpruuniks praadida" is a manual; "Prae kana pannil kuldpruuniks" is a person talking.
- **Time and temperature in metric, with the unit.** `200 °C`, `5–6 minutit`, `500 g`, `2 dl`. Space between number and unit; en dash in ranges; decimal comma (`1,5 kg`).
- **`kummaltki poolt`, `kuldpruuniks`, `pehmeks`, `läbi`** are the everyday doneness words. Not "kuni sisetemperatuur on 74 °C".
- **Pitfalls name the mistake and the consequence in one sentence.** "Ära pane liiga palju kana korraga pannile: liha hakkab hauduma, mitte pruunistuma."
- **Equipment is a noun phrase, specific.** `Suur ahjukindel pann`, `Kaanega pott`, `Terav nuga ja lõikelaud`. Not "Pann".

| Bad                                                                         | Good                                                        |
| --------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Kuumutage ahi 200 kraadini.                                                 | Kuumuta ahi 200 °C-ni.                                      |
| Kõigepealt tuleks sibul peeneks hakkida.                                    | Haki sibul peeneks.                                         |
| Kana tuleb pannil kuldpruuniks praadida, umbes 5–6 minutit mõlemalt poolt.  | Prae kana pannil kuldpruuniks, 5–6 minutit kummaltki poolt. |
| Nüüd on aeg lisada riis ja segada see hoolikalt teiste koostisosadega läbi. | Lisa riis ja sega läbi.                                     |
| Palun jälgi, et pasta ei keeks üle.                                         | Jälgi, et pasta üle ei keeks.                               |
| Serveerimine: roog serveeritakse kuumalt koos värske peterselliga.          | Serveeri kohe, peale puista värsket peterselli.             |
| Preheat the oven to 400°F and bake for 25 minutes.                          | Kuumuta ahi 200 °C-ni ja küpseta 25 minutit.                |

## Ingredient names

The `name` field on every AI-returned ingredient is a matcher key: it is looked up against `IngredientTranslation.name` and, when nothing matches, becomes a household-scoped ingredient row that the partner sees on the shopping list. Two rules beyond the nominative-singular form covered below:

- **The everyday shop word, not the botanical or official term.** `brokkoli`, not `spargelkapsas`; `kanakoib`, not `kana reieliha`; `kanafilee`, not `kana rinnafilee`. The seeded translations are calibrated to the shop word (HON-536 reviews the ~1,100 AI-seeded names against this same rule), so the official term silently misses the match.
- **Nothing but the word.** No parentheticals, no qualifiers, no preparation words: `kanakoib`, not `kana reieliha (kondita)`; `sibul`, not `sibul, hakitud`. Those belong in `originalText` or the step.
- **`vaguePhrase` stays English.** It is not prose either: `getPhraseGroup` in `src/lib/vague-quantities.ts` compares it by exact equality against the English `VAGUE_PHRASES` list to pick the per-category default quantity. `soola maitse järgi` is `name: "sool", vaguePhrase: "to taste", originalText: "soola maitse järgi"`. An Estonian `vaguePhrase` (or `null`) matches no group and falls through to a flat 10 g per serving, so a four-serving recipe gets 40 g of salt instead of 4 g, silently, because the guardrail only runs on non-vague rows.
- **Latin letters only.** Estonian diacritics (`õ ä ö ü š ž`) are Latin. The model has slipped a Cyrillic `п` or `р` into words like `karripulber` on two of six sampled runs; the character looks identical and breaks the match. The prompt says so explicitly; if it keeps happening, the fix is a normalisation step in the matcher, not more prompt text.

## Case inflection and compound strings

Estonian has 14 noun cases, and the case a word takes depends on the words around it. Any string composed at runtime from a fixed template and a variable (`"{count} {item}"`) will be wrong in Estonian whenever the template's grammar needs the variable in a case other than the one it is stored in. There is no runtime inflection library in this codebase and there will not be one; the rule is:

**When the template's grammar breaks, reword the template so the variable sits in a slot that takes the nominative. Do not try to parameterize the case.**

Three ways a slot can be made nominative-safe:

1. **Colon or label structure.** `Kogus: 3 tk` instead of `3 {item}`.
2. **Quotation marks.** A quoted name is a citation and stays nominative: `Kustutada „Kanakarri“?`
3. **Move the variable to subject position or to the end after a dash.** `{item} lisati ostunimekirja`, `Vahetada välja – {meal}`.

### Rework-vs-parameterize examples

**1. Counts.** Estonian puts the noun after a numeral in the partitive singular: `1 sibul`, `2 sibulat`, `5 sibulat`; `1 muna`, `3 muna`. An English-shaped `{count} {item}` with `item` stored as the nominative (`sibul`) yields `3 sibul`, which is wrong.

| Bad template                 | Reworded                             |
| ---------------------------- | ------------------------------------ |
| `{count} {item}` → "3 sibul" | `{item}: {count} tk` → "sibul: 3 tk" |

ICU plurals in `messages/et.json` handle the case when the noun is _in_ the message (`{n, plural, one {# portsjon} other {# portsjonit}}`), because both forms are authored by hand. They cannot help when the noun is a runtime value.

**2. Objects of a verb.** "Do you want to delete {item}?" needs the partitive: `Kas soovid kustutada sibulat?` The stored name is `sibul`.

| Bad template                                                   | Reworded                                     |
| -------------------------------------------------------------- | -------------------------------------------- |
| `Kas soovid kustutada {item}?` → "Kas soovid kustutada sibul?" | `Kustutada „{item}“?` → "Kustutada „sibul“?" |

**3. "X with Y" composition.** "{meal} with {side}" needs the comitative on the side: `Kanakarri riisiga`. Composing it from two nominatives gives `Kanakarri koos riis`.

| Bad template         | Reworded                                                                                                           |
| -------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `{meal} koos {side}` | Do not compose meal names at runtime. The AI returns a complete name (`Kanakarri riisiga`); chrome shows it whole. |

**4. Swap and replace prompts.** "Replace {meal}?" takes the partitive on `meal` (`Vahetada Kanakarrit?`), and the stored name is the nominative.

| Bad template       | Reworded                                         |
| ------------------ | ------------------------------------------------ |
| `Vahetada {meal}?` | `{meal} – vahetada?` or `Vahetada välja: {meal}` |

**5. Quantities in prose vs. matcher keys.** The AI returns two strings per ingredient: `name`, which the ingredient matcher looks up against `IngredientTranslation.name`, and a human-readable `originalText` (imagine-meal) or the prose of a step. After a quantity, Estonian prose wants the partitive: `500 g kanafileed`, `2 sibulat`, `1 tl soola`, `3 küüslauguküünt`. The matcher key must stay nominative singular: `kanafilee`, `sibul`, `sool`, `küüslauk`.

| Field                                       | Form                                                           | Example                                                         |
| ------------------------------------------- | -------------------------------------------------------------- | --------------------------------------------------------------- |
| `name` (matcher key)                        | lowercase, nominative singular, matches the seeded translation | `kanafilee`, `sibul`, `hapukoor`, `oliiviõli`                   |
| `originalText`, `steps`, `preparationNotes` | natural prose, inflected                                       | `500 g kanafileed`, `Haki 2 sibulat peeneks`, `Lisa 1 tl soola` |

Getting this backwards in either direction is the most common AI error in Estonian output: nominative prose ("Lisa 500 g kanafilee") reads machine-made, and an inflected key ("kanafileed") silently creates a duplicate household-scoped ingredient row.

### Compound-noun genitive

The first part of a compound takes the genitive, and for many nouns the genitive differs from the nominative: `sibul` → `sibulasupp`, `kartul` → `kartulisalat`, `seen` → `seenerisotto`, `kapsas` → `kapsarull`, `lõhe` → `lõhesupp` (genitive identical). Chrome strings that build compounds from a variable (`{ingredient}supp`) are therefore never safe. Write the whole word by hand, or restructure as `Supp: {ingredient}`.

## How the prompts use this

Three helpers in `src/lib/ai/prompts.ts` distil this document into a prompt suffix, each appended after `localeInstruction(locale)` and each returning an empty string for every locale but `et`, so English prompts stay byte-identical:

| Helper                        | Call site                                                 | Fields covered                                               |
| ----------------------------- | --------------------------------------------------------- | ------------------------------------------------------------ |
| `estonianVoiceForImagineMeal` | `src/lib/ai/imagine-meal.ts`                              | `name`, `description`, ingredient `name` vs. `originalText`  |
| `estonianVoiceForRecipeParse` | `src/lib/ai/recipe-prompt.ts`                             | `name`, `description`, `preparationNotes`, ingredient `name` |
| `estonianVoiceForPrepTips`    | `src/lib/ai/preparation-tips.ts` (full and supplementary) | `equipment`, `steps`, `pitfalls`, `tip`                      |

Each helper carries a short rules block and three to five few-shot pairs (English-shaped input → idiomatic Estonian output). The pairs are what the model actually imitates; the rules are there so a future tuner knows _why_ the pairs look the way they do. When tuning, change a pair before adding a rule.

Real outputs land in `.ai-samples/<date>.jsonl` (see [LOCALIZATION.md → Reviewing AI output quality](./LOCALIZATION.md#reviewing-ai-output-quality)). Review them against this document; if a pattern keeps reading translated, add the offending output as a "bad" example to the relevant few-shot block.

## Related

- [LOCALIZATION.md](./LOCALIZATION.md), the three-tier model and the sampling tool.
- HON-503, the issue that introduced this document and the prompt helpers.
- HON-507, the seeded meal translations this voice is calibrated to.
- HON-536, the pre-partner-test copy review that walks every surface against this reference.
