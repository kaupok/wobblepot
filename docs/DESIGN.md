# Wobblepot design guide

> **Status: draft.** Core rules only. Read this before building or changing any UI. Rules cite the decision that produced them (`HON-NNN`) so the reasoning can be traced. Items marked **Proposed** describe where we want to be, not where the code is today.

**How to use this file:** judgment lives here in prose. Anything that can be checked mechanically (a token, a class, a component) lives in code, and this file points at it. When a review finds the same visual problem twice, name it in [Reject list](#reject-list) so agents recognise it instead of re-inferring it.

## Who we design for

- A tired parent at 5pm, holding a phone in one hand, deciding what to cook. Every screen must work at 390px width, thumb-reachable, with one obvious next action.
- Decisions are quick and repeated weekly. Familiar layout beats novel layout. Nothing should need learning twice.
- The AI is the engine, not the story. The interface shows meals, ingredients, and plans, never "magic".

## Primitives we already have

Use these. Do not restyle them per feature or invent parallel ones.

| Concern         | Where it lives                                                                                                                          | Notes                                                                                                                                                           |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Color tokens    | `src/app/globals.css` (`--background`, `--primary`, `--muted`, `--destructive`, `--success`, `--warning`, `--info` + `-muted` surfaces) | shadcn `new-york`, `neutral` base, oklch, light + dark via `.dark` class. Status pairings are contrast-checked by the `UI/Tokens` story                         |
| Fonts           | `Geist` (sans), `Geist Mono` (mono), loaded in `src/app/layout.tsx`                                                                     | Mono only for code, IDs, and quantities that must align                                                                                                         |
| Type components | `src/components/ui/typography.tsx` (`Heading`, `Body`, …)                                                                               | Text styling only. Layout goes on a wrapper. See [docs/TYPOGRAPHY.md](TYPOGRAPHY.md)                                                                            |
| UI primitives   | `src/components/ui/*`                                                                                                                   | shadcn; `Button`, `Card`, `Badge`, `Dialog`, `Sheet`, `Select`, `Input`, `Table`, …                                                                             |
| Icons           | `lucide-react`                                                                                                                          | `size-4` inline in buttons, `h-3 w-3` in meta rows next to caption text                                                                                         |
| Page shell      | `src/app/layout.tsx`, `src/components/header.tsx`, `src/components/bottom-tab-bar.tsx`                                                  | Fixed header, bottom tab bar on mobile, content column capped at 1152px (`HON-376`)                                                                             |
| Review harness  | Storybook (`pnpm storybook`), mobile viewport by default                                                                                | Every component change ships with a story. Axe runs on every story in CI. **Proposed:** `Scenarios/*` composite stories plus a DOM design-rule helper (HON-610) |

## Type scale

Five levels for authenticated app pages (`HON-381`). Differentiate by color before size.

| Level     | Use for                                                   | Component                                                                                         | Renders as                         |
| --------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ---------------------------------- |
| Title     | Page heading: "Shopping list", "My recipes"               | `<Heading variant="h4">`                                                                          | `text-xl font-semibold`            |
| Section   | Day names, form sections ("Ingredients")                  | `<Heading variant="section">` (day names only so far — form sections are still `h4`, see HON-613) | `text-base font-semibold`          |
| Body      | Single-line items: meal names, ingredient rows, links     | `<Body variant="small">`                                                                          | `text-sm font-medium leading-none` |
| Secondary | Helper text, descriptions, summaries; any text that wraps | `<Body variant="muted">`                                                                          | `text-sm text-muted-foreground`    |
| Caption   | Meal-type labels, badges, quantities, day tags            | `<Body variant="caption">`                                                                        | `text-xs font-medium muted`        |

Rules:

- No arbitrary font sizes (`text-[10px]`). If a size is not in the scale, the design is wrong, not the scale.
- Do not override a `Body` variant's size with `className`. Pick the right variant.
- `Heading` `h1`, `h2`, `h3` are for the marketing landing page, legal pages, error pages, and internal pages (`/status`, `/bot`, `/admin`). Inside the household-facing app, page titles are `h4`. Five in-app components still use `h2` (`ShoppingEmptyState`, `MemberList`, `FirstTimeSetup`, `GeneratingOverlay`, `HouseholdSettingsForm`); decided 2026-09-03 to migrate them, not to add an exception.
- Do not wrap `Heading` in `CardTitle` or `Body` in `CardDescription`. One component per text element.
- Visual level and HTML tag are separate choices. `variant` sets the size, `as` sets the tag. Pick the tag for document outline (no skipped levels, one `h1` per page) and the variant for the type scale. Decided 2026-09-03, shipped in HON-606. Omitting `as` renders the variant's natural tag (`section` → `h2`), so only pass it when the outline needs a different level than the scale.

## Spacing, radius, elevation

Spacing rhythm as used today (Tailwind steps, 4px each):

| Relationship                       | Gap                  |
| ---------------------------------- | -------------------- |
| Lines inside one card or list row  | `gap-1.5` to `gap-2` |
| Controls in a row, items in a list | `gap-3`              |
| Blocks inside a page section       | `gap-4`              |
| Between page sections              | `gap-6` to `gap-8`   |
| Page horizontal padding            | `px-4`               |

- One element owns each gap. Use `gap-*` on a flex or grid parent, not margins on children.
- Radius: `rounded-md` for controls (buttons, inputs, badges are `rounded-full`), `rounded-lg` for list rows and dialogs, `rounded-xl` for `Card`. Do not mix within one component.
- Elevation: `shadow-xs` on outline controls, `shadow-sm` on cards, `shadow-lg` only on overlays (dialog, sheet, popover). Nothing else casts a shadow.
- Interactive list rows and tab items are at least 44px tall on mobile (today only two shopping rows set `min-h-[44px]`; the tab bar relies on its 64px container and sets no per-item floor. **Proposed:** a named `min-h-touch` utility and a rollout, HON-609).

## Color

- Design in monochrome first. The neutral palette carries hierarchy through weight, size, and `muted-foreground`, not hue.
- Color adds meaning, never decoration. Every colored element also carries a non-color cue: an icon, a label, or a text change.
- The only accent that exists is `primary` (near-black in light, near-white in dark). Do not introduce a brand hue in components ahead of a brand decision.
- Status has three generic tokens, each with a `-muted` tinted surface: `success`, `warning`, `info`. Use `text-success` for emphasis (text and icons), `bg-success-muted` for the surface, and `border-success/30` for a border — an opacity modifier on the emphasis token, not a token of its own. Red is not one of them: failure stays on `destructive`, so it never reads as one more status.
- Domain names (available, missing, staple) stay in component props and copy, never in a token name. `AvailabilityIndicator` decides that "available" is success; the token does not know what it means.
- A `-muted` surface is for short, emphasis-coloured content: pills, badges, icon chips, callouts. It is **not** a panel fill for a block of body copy, because `muted-foreground` is calibrated for the neutral background — it measures 4.60:1 on white, so on any tint it lands at 4.3–4.5:1 and fails AA. A content panel that carries `Body variant="muted"` gets the border and no fill (`border-success/30`); the coloured icon and the coloured name already carry the meaning, and the fill was decoration.
- Never reach for a raw palette class (`text-amber-700`, `bg-green-100`). Every emphasis-on-muted pairing is measured at ≥5:1 in both themes; a hand-picked shade is unmeasured. `UI/Tokens` in Storybook renders every pairing as real text, so the axe gate re-measures them on each run.
- Never write a `dark:` override for a semantic token. Tokens already switch. There are no raw palette classes left under `src/**/*.tsx`, so a new `dark:` colour override means you have gone around the tokens — these two greps must both stay empty:

  ```bash
  grep -rnE "(bg|text|border|fill)-(red|green|blue|amber|orange|yellow)-[0-9]{2,3}" src --include='*.tsx' | grep -v stories
  grep -rnE "dark:(bg|text|border)-(red|green|blue|amber|orange|yellow)-" src --include='*.tsx'
  ```

## Composition rules

Each of these came from a review that found the opposite in production.

- **Headings divide, borders contain.** Group items under a heading, not inside a bordered wrapper. The only bordered elements in a list are the interactive items themselves (`HON-386`).
- **No cards inside cards.** If a `Card` needs internal grouping, use spacing and a section heading (`HON-386`).
- **Actions sit on the title row.** A card's actions align right on the same line as its name, in one row, never as a footer strip or stacked buttons (`HON-378`, `HON-383`).
- **Labels sit outside the card.** Context labels like the meal type ("Dinner") go above the card as a caption, not inside it (`HON-379`).
- **Content is not sticky.** Action bars live inline at the end of the content they act on. The only fixed chrome is the header and the mobile tab bar (`HON-380`).
- **One page width.** Content is centered and capped at 1152px. Tables and lists may fill it; prose stays narrower (`HON-376`).
- **Controls belong in menus, not headers.** Preference toggles (theme, language) live in the user menu, not in the header bar (`HON-382`).
- **Mobile first, then widen.** Build the 390px layout, then add `md:` and `lg:` variants. Never the reverse (`HON-395`).

## Copy

Full voice guide: [docs/PROJECT_SPEC.md → Brand voice and tone](PROJECT_SPEC.md#brand-voice-and-tone). The operational rules:

- Sentence case everywhere. "Add meal", not "Add Meal".
- Actions are imperative verbs: "Add meal", "Skip dinner", "Generate week".
- Empty states say what is true and what to do next, in that order: a `Body variant="muted"` line plus one primary `Button`. No illustrations, no jokes about the emptiness.
- Errors say what happened and what to do, never what went wrong technically. "We couldn't save that. Try again." not "Request failed (500)."
- One light-touch phrase per screen at most. Warm is a seasoning, not the dish.

## Reject list

Agents produce these by default. Recognise them and do not ship them.

- Cards nested inside cards, or a bordered wrapper around a list of bordered items
- A sticky or floating action bar inside page content
- Page titles above `text-xl` inside the app
- Arbitrary font sizes (`text-[10px]`, `text-[13px]`)
- A raw palette class (`text-green-600`) where an existing pairing or token exists
- A `dark:` override on a semantic token
- Gradients, glows, blurred blobs, glass effects, colored side rails, decorative shadows
- Decorative icons or illustrations in empty states
- An eyebrow label in all caps above every heading
- Centered hero plus a three-card grid for anything that is not the landing page
- Three or more buttons of equal weight in one row. One primary, the rest `outline` or `ghost`
- Playful copy on more than one element per screen
- A theme or language toggle placed in the header

## Open questions for review

Add one here when a review finds code and rule disagreeing and the fix is not obvious.

1. The default `Button` is `h-9` (36px), below the 44px touch rule. Options: leave buttons at 36px and scope the rule to list rows and tab items (the wording above does this for now), or make `size="lg"` (40px) the mobile default for primary actions, or raise the default. HON-609 will list every interactive element under 44px at the mobile viewport so this can be decided on evidence.

2. The Body level has no wrapping variant. `Body variant="small"` is `leading-none`, so it is only safe for single-line items; multi-line text currently falls back to `muted`. Options: add a `body` variant (`text-sm leading-normal`) or loosen `small`. Still open — HON-606 shipped `Heading`'s `as` prop without taking a position on this, since it needs a design call rather than a mechanical change.

## Pending code changes

Decisions above that the code does not yet reflect. Each has a Linear issue; update this list when one ships.

- HON-607: migrate the five in-app `Heading variant="h2"` usages to `h4` (type scale).
- HON-613: migrate the seven form-section headings from `Heading variant="h4"` to `variant="section"` — `MealForm.tsx:153` ("Ingredients", the row's own example), `MealFormBasicInfo.tsx:32`, `MealFormDetails.tsx:57`, `HouseholdSettingsForm.tsx:258/318/368/385`. HON-606 shipped the variant and migrated only the day-name callsite (type scale).
- HON-609: name the 44px touch-target height as a utility (spacing).
- HON-610: add three `Scenarios/*` stories and the `assertDesignRules` DOM helper (review harness).
