# Wobblepot design guide

> **Status: draft.** Core rules only. Read this before building or changing any UI. Rules cite the decision that produced them (`HON-NNN`) so the reasoning can be traced. Items marked **Proposed** describe where we want to be, not where the code is today.

**How to use this file:** judgment lives here in prose. Anything that can be checked mechanically (a token, a class, a component) lives in code, and this file points at it. When a review finds the same visual problem twice, name it in [Reject list](#reject-list) so agents recognise it instead of re-inferring it. Reviews check against the [Reject list](#reject-list) and [Composition rules](#composition-rules) only; a finding must name the item it matches, and anything this file does not name is taste rather than a finding (`HON-615`).

## Who we design for

- A tired parent at 5pm, holding a phone in one hand, deciding what to cook. Every screen must work at 390px width, thumb-reachable, with one obvious next action.
- Decisions are quick and repeated weekly. Familiar layout beats novel layout. Nothing should need learning twice.
- The AI is the engine, not the story. The interface shows meals, ingredients, and plans, never "magic".

## Primitives we already have

Use these. Do not restyle them per feature or invent parallel ones.

| Concern         | Where it lives                                                                                                                          | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Color tokens    | `src/app/globals.css` (`--background`, `--primary`, `--muted`, `--destructive`, `--success`, `--warning`, `--info` + `-muted` surfaces) | shadcn `new-york`, `neutral` base, oklch, light + dark via `.dark` class. Status pairings are contrast-checked by the `UI/Tokens` story                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Fonts           | `Geist` (sans), `Geist Mono` (mono), loaded in `src/app/layout.tsx`                                                                     | Mono only for code, IDs, and quantities that must align                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Type components | `src/components/ui/typography.tsx` (`Heading`, `Body`, …)                                                                               | Text styling only. Layout goes on a wrapper. See [docs/TYPOGRAPHY.md](TYPOGRAPHY.md)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| UI primitives   | `src/components/ui/*`                                                                                                                   | shadcn; `Button`, `Card`, `Badge`, `Dialog`, `Sheet`, `Select`, `Input`, `Table`, …                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Icons           | `lucide-react`                                                                                                                          | `size-4` inline in buttons and beside body text, `size-3.5` in meta rows next to caption text, `size-6` in the bottom tab bar (HON-687). Write new sizes as `size-*`, not `h-* w-*`                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Page shell      | `src/app/layout.tsx`, `src/components/header.tsx`, `src/components/bottom-tab-bar.tsx`                                                  | Fixed header, bottom tab bar on mobile, content column capped at 1152px (`HON-376`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Review harness  | Storybook (`pnpm storybook`), mobile viewport by default, plus `@shadcn/lint` in `pnpm lint`                                            | Every component change ships with a story. Axe runs on every story in CI. `Scenarios/*` stories compose whole screens, and each one runs `assertDesignRules` from `src/stories/design-rules.ts` over its DOM, so the mechanical rules below fail CI rather than a review (HON-610). `@shadcn/lint` covers the static half from the other side — five rules as errors on every `src` file, story or not, whether or not a scenario renders it (HON-673). The two overlap on raw colours and complement each other everywhere else: the linter sees files no story reaches, the DOM helper sees classes assembled at runtime. Keep both |

## Type scale

Five levels for authenticated app pages (`HON-381`, raised one step in `HON-686`). Differentiate by color before size.

| Level     | Use for                                                   | Component                     | Renders as                         | Size / line |
| --------- | --------------------------------------------------------- | ----------------------------- | ---------------------------------- | ----------- |
| Title     | Page heading: "Shopping list", "My recipes"               | `<Heading variant="h4">`      | `text-xl font-semibold`            | 22px / 30px |
| Section   | Day names, form sections ("Ingredients")                  | `<Heading variant="section">` | `text-base font-semibold`          | 18px / 28px |
| Body      | Single-line items: meal names, ingredient rows, links     | `<Body variant="small">`      | `text-sm font-medium leading-none` | 16px / 16px |
| Secondary | Helper text, descriptions, summaries; any text that wraps | `<Body variant="muted">`      | `text-sm text-muted-foreground`    | 16px / 24px |
| Caption   | Meal-type labels, badges, quantities, day tags            | `<Body variant="caption">`    | `text-xs font-medium muted`        | 14px / 20px |

**`text-xs` … `text-xl` are not stock Tailwind values.** They are re-based one step up in the top-level `@theme` block of `src/app/globals.css` (HON-686): `text-xs` 14/20, `text-sm` 16/24, `text-base` 18/28, `text-lg` 20/28, `text-xl` 22/30. The stock values (14px body, 12px captions) are a dashboard scale, and our reader holds a phone at arm's length. The names were kept so every primitive, variant and raw `text-sm` moves together, and so the next `text-xs` an agent writes lands at 14px rather than 12px. `text-2xl` and up are stock — only marketing, legal and error pages use them. Inputs keep `text-base md:text-sm`, now 18px on phones and 16px from `md`, so both halves stay at or above the 16px iOS no-zoom floor. `UI/Tokens` → `TypeScale` measures every value in Chromium, and the `title-scale` design rule reads its limit from a `text-xl` probe, so neither needs editing when a value moves — this table and the story's `TYPE_SCALE` do.

Rules:

- No arbitrary font sizes (`text-[10px]`). If a size is not in the scale, the design is wrong, not the scale.
- Do not override a `Body` variant's size with `className`. Pick the right variant.
- `Heading` `h1`, `h2`, `h3` are for the marketing landing page, legal pages, error pages, and internal pages (`/status`, `/bot`, `/admin`). Inside the household-facing app, page titles are `h4` — no exceptions for overlays or empty states. Decided 2026-09-03, shipped in HON-607, which migrated the last five in-app `h2` components (`ShoppingEmptyState`, `MemberList`, `FirstTimeSetup`, `GeneratingOverlay`, `HouseholdSettingsForm`). Each kept its `<h2>` tag via `as`, so the size changed and the outline did not — except `GeneratingOverlay`, whose tag HON-619 then moved to `<h4>` because the overlay renders inline beside `h5` day labels and `<h2>` there is a skipped level. `/household` was the last in-app page title still on the `h1` _variant_ — a bare `<Heading>`, which falls through to `defaultVariants`; HON-618 moved it to `variant="h4" as="h1"`, keeping the `<h1>` its outline needs. The rule now holds in code: this grep should return only the exempt page types (marketing landing, legal, `/bot`, `global-error`). It spans `src/components` as well as `src/app` — four of the five components named above live there — and matches an explicit `variant="h1"` and a `className`-only `<Heading>`, both of which land on the same `text-4xl` default.

  ```bash
  grep -rnE '<Heading( className=[^>]*)?>|variant="h1"' src/app src/components --include='*.tsx' | grep -v '\.test\.\|\.stories\.'
  ```

- Do not wrap `Heading` in `CardTitle` or `Body` in `CardDescription`. One component per text element.
- Visual level and HTML tag are separate choices. `variant` sets the size, `as` sets the tag. Pick the tag for document outline (no skipped levels, one `h1` per page) and the variant for the type scale. Decided 2026-09-03, shipped in HON-606. Omitting `as` renders the variant's natural tag, so for `h1`-`h4` only pass it when the outline needs a different level than the scale. `variant="section"` is the standing exception: its natural tag is `<h2>`, which is above almost every title a section sits under, so **every production `section` callsite passes an explicit `as`** — one level below the rendered tag of its enclosing title, read at the callsite rather than assumed. Shipped across HON-606, HON-613 and HON-619; this grep should return only stories, tests and prose:

  ```bash
  grep -rn 'variant="section"' src --include='*.tsx' | grep -v 'as='
  ```

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
- Elevation: only overlays cast a shadow. `shadow-md` on anchored overlays (select, top-level dropdown, autocomplete lists), `shadow-lg` on modal overlays (dialog, alert dialog, sheet) and the dropdown sub-menu, which stacks on top of its parent menu. Nothing in the page — controls, cards, badges, rows — has one; the border is the edge. HON-689 removed shadcn's default `shadow-xs` / `shadow-sm` from controls and `Card`, so a `shadcn add` can bring them back — strip them. The `no-content-shadow` scenario rule fails on any visible shadow outside an element with `role="dialog" | "alertdialog" | "menu" | "listbox"` or an overlay `data-slot` listed in `OVERLAY_SLOTS` in `src/stories/design-rules.ts` (a hand-rolled popover gets `data-slot="autocomplete-content"`; `card-content` and `collapsible-content` are in the page and are not listed); focus rings are spread-only and do not count. The grep below must return only overlays — `dialog`, `alert-dialog`, `sheet`, `dropdown-menu`, `select` (content only), `InlineAddItem`, `UnmatchedIngredientRow`, `IngredientSearch`:

  ```bash
  grep -rnE "shadow-(xs|sm|md|lg|xl)" src --include='*.tsx' | grep -v '\.stories\.\|\.test\.'
  ```

- Control height is `touch` (44px) below `md` and 40px from `md`, on `Button`, `Input`, and `Select` (`lg` and `icon-lg` 48 / 44px, `icon` 44 / 40px). HON-687 raised the `md` half from 36px: after HON-686 a `Button` label is a 16px font on a 24px line, and `py-2` around that line needs 40px — at 36px the line overran its padding box. Skeleton control bars mirror it as `h-touch md:h-10`. `sm` is for secondary inline actions; a screen's primary action is never `sm`.
- To change a control's height, pick a variant — never a `className`. Since those variants are responsive, a `className="h-8"` only overrides the base half: the variant's `md:` half carries a different modifier, so `cn()` keeps it, and Tailwind emits every `md:` utility in one media block after the base ones at equal specificity. The override therefore silently applies on mobile only, and the control is one height on a phone and another on a desktop. `sm` and `icon-sm` carry no breakpoint and are the fixed-height escape hatch (`button.test.tsx` asserts that). The same asymmetry applies to a `Select` trigger, where `data-[size=default]:h-10` also outranks a bare `h-8` on specificity alone — pass `size="sm"` instead.
- Interactive list rows and tab items are at least 44px tall on mobile. The floor has a name: `--spacing-touch: 44px` in `globals.css`, which yields `min-h-touch`, `h-touch`, and `size-touch`. Use those; never copy `min-h-[44px]` into a new row. `ShoppingItem` and `CustomShoppingItem` set it, and each tab item clears it at 56px off its own padding rather than an explicit floor. Shipped in HON-609. `UI/Tokens` → `TouchTarget` measures the token in a real browser, so CI fails if it stops resolving to 44px.
- A new `--spacing-*` token must be added to `CUSTOM_SPACING_VALUES` in `src/lib/utils.ts` in the same PR that declares it in `globals.css`. Untold, `tailwind-merge` does not recognise the value as a member of the height/width/gap/padding groups and keeps both sides of a conflict, so every `className` override of it silently stops working — latent until something sizes a component with the token (HON-609 declared `touch`, HON-612 consumed it, PR #704 review found it). `utils.test.ts` fails if the two lists drift. Colour tokens need no such registration — `tailwind-merge`'s `color` scale is `isAny`. Radius does **not** get the same pass: its scale is `isTshirtSize`, so `--radius-sm/md/lg/xl` resolve only because they happen to be t-shirt names, and a `--radius-card` would repeat this bug with no guard to catch it. Same for `--text-*`, `--shadow-*`, `--blur-*`, `--container-*` and `--animate-*`.
- Controls below the 44px floor are all deliberate, and all at 32px through a size variant, never a `className`. HON-612 raised the size variants (measured at 390px: `Button` default 44, `lg` 48, `icon` 44, `icon-lg` 48; `sm` 32 and `icon-sm` 32 by design), which reaches only elements that take their height from the variant. HON-688 moved everything that bypassed them onto one — the raw `<button>`s in `NoteEditor`, `CustomShoppingItem`, `MealRatingInline` and `RatingBadge`, and the `h-5` / `h-6` / `h-7` overrides in `MealCard`, `MealRatingPrompt` and `TimelineEmptySlot` — so what is left below 44px is `sm` and `icon-sm` by choice: card-row actions where 44px zones with a 6px gap would overlap. That covers `PantryItem` and `PantrySection` (star and trash at `icon-sm` for the 32px card-action rhythm), the `MealCard` and `CustomShoppingItem` actions, and the rating thumbs. Two text targets stay native `<button>`s because they wrap and every `Button` size is a fixed height a second line would overflow: `MealCard`'s meal name and `NoteEditor`'s note. Both carry `min-h-8`, so they hold the same 32px floor. `MealCard` puts Swap and Clear behind one `icon-sm` "More actions" menu next to Note, because three labelled `sm` buttons leave a 390px card too little room for the name. Stories measure the floor: `MealCard` → `Planned`, `MealRating`, `NoteEditor`, and `CustomShoppingItem` → `Default`.
- `Checkbox` and `RadioGroupItem` are 20px (`size-5`) by default, sized for the 16px body text they sit beside (HON-687); no callsite overrides the size. In `ShoppingItem` the `<label>` wraps the whole 54px row, so the real target is the row; in `CustomShoppingItem` the label covers only the 28px text block, so the checkbox is closer to a bare 20px target.

## Color

- Design in monochrome first. The neutral palette carries hierarchy through weight, size, and `muted-foreground`, not hue.
- Color adds meaning, never decoration. Every colored element also carries a non-color cue: an icon, a label, or a text change. The one exception is a meal's `imageHue`, which tints that meal's card and hero from its illustration; it is the only colour driven by data, and its lightness and chroma are fixed tokens. See [Imagery](#imagery).
- The only accent that exists is `primary` (near-black in light, near-white in dark). Do not introduce a brand hue in components ahead of a brand decision. A meal's hue is not an accent: it lives only on that meal's card and hero.
- Status has three generic tokens, each with a `-muted` tinted surface: `success`, `warning`, `info`. Use `text-success` for emphasis (text and icons), `bg-success-muted` for the surface, and `border-success/30` for a border — an opacity modifier on the emphasis token, not a token of its own. Red is not one of them: failure stays on `destructive`, so it never reads as one more status.
- Domain names (available, missing, staple) stay in component props and copy, never in a token name. `AvailabilityIndicator` decides that "available" is success; the token does not know what it means.
- A `-muted` surface is for short, emphasis-coloured content: pills, badges, icon chips, callouts. It is **not** a panel fill for a block of body copy, because `muted-foreground` is calibrated for the neutral background — it measures 4.60:1 on white, so on any tint it lands at 4.3–4.5:1 and fails AA. A content panel that carries `Body variant="muted"` gets the border and no fill (`border-success/30`); the coloured icon and the coloured name already carry the meaning, and the fill was decoration.
- Never reach for a raw palette class (`text-amber-700`, `bg-green-100`). Every emphasis-on-muted pairing is measured at ≥5:1 in both themes; a hand-picked shade is unmeasured. `UI/Tokens` in Storybook renders every pairing as real text, so the axe gate re-measures them on each run.
- Never write a `dark:` override for a semantic token. Tokens already switch. There are no raw palette classes left under `src/**/*.tsx`, so a new `dark:` colour override means you have gone around the tokens.

  `shadcn/no-raw-colors` owns the _raw palette class_ half of this: it runs on every `pnpm lint`, covers the whole palette rather than the six hues below, and also catches a colour class naming a token that `globals.css` never declared — which is how `text-destructive-foreground` sat on two destructive dialog actions generating no CSS at all until HON-673 found it. It does **not** enforce the no-`dark:`-override half: `dark:text-primary` is a legitimate token reference as far as the rule is concerned, and `button.tsx` ships `dark:bg-destructive/60` deliberately. That half is still the greps plus review, and **both greps must return empty** (they also cover the runtime-assembled classes and the tests and stories the lint rule skips):

  ```bash
  grep -rnE "(bg|text|border|fill)-(red|green|blue|amber|orange|yellow)-[0-9]{2,3}" src --include='*.tsx' | grep -v stories
  grep -rnE "dark:(bg|text|border)-(red|green|blue|amber|orange|yellow)-" src --include='*.tsx'
  ```

## Motion

How often someone sees a motion decides whether it gets one. Our user repeats the same few actions every week on a phone, so the app should feel instant; motion is only for changes a person would otherwise miss. Decided 2026-09-14, adapted from the public `better-ui` and `emil-design-eng` skills, taking one value where they disagree and dropping what conflicts with this guide. Applied to the code in HON-665.

| How often             | Examples                                                                 | Motion                                              |
| --------------------- | ------------------------------------------------------------------------ | --------------------------------------------------- |
| Many times a session  | Ticking a shopping item, toggling a pantry staple, hover, switching tabs | None, or a colour or opacity change of 150ms        |
| A few times a session | Dialog, sheet, dropdown, select, toast, a newly added row                | The standard enter and exit below                   |
| Rarely                | A generated week appearing                                               | Same as above. No staggers or reveals for AI output |

- **Durations are a set, not a range:** 150ms for control feedback (press, hover, colour), 200ms for menus, dialogs, and every exit, 300ms for a sheet opening. No transition or one-shot animation inside the app runs longer; looping indicators (`animate-spin`, `Skeleton`'s `animate-pulse`) are not state changes and keep their own cycle. An exit is never slower than its enter. If a motion needs another value, the motion is wrong, not the set.
- **Easing:** `ease-out` for anything that enters, exits, or answers a press. `globals.css` overrides Tailwind's `--ease-out` to `cubic-bezier(0.23, 1, 0.32, 1)`, so the stock utility is the house curve and no one hand-writes a `cubic-bezier`. Never `ease-in`: it starts slow at the moment the user is watching. `linear` only for constant motion such as a spinner.
- **Name what transitions.** `transition-colors`, `transition-opacity`, or `transition-[…]` listing the properties. Never `transition-all`: it animates changes nobody meant to animate and hides which ones matter.
- **Transitions for state, keyframes for mount and unmount.** A state change on an element that stays mounted (toggle, press, hover, expand) uses a CSS transition, which retargets when reversed midway; keyframes restart from zero. Radix overlays are the exception and stay on `animate-in` / `animate-out`: Radix's `Presence` waits for a keyframe animation to end before unmounting, so a transition-only Dialog or Sheet would vanish on close without animating.
- **Nothing grows from nothing.** Overlays enter from `zoom-in-95` plus `fade-in-0`, never `scale-0`. Anchored overlays (dropdown, select, tooltip) scale from their trigger through Radix's `origin-(--radix-*-transform-origin)`; dialogs stay centred.
- **Press feedback.** `Button` scales to `0.97` on `:active`, except the `link` variant. It is the only press animation in the app, and it exists because a phone has no hover, so a tap is otherwise silent until the result arrives.
- **Theme switches snap.** `next-themes` runs with `disableTransitionOnChange`, and `ThemeToggle` swaps its icon without animating.
- **Motion is never the only signal.** Every animated change also changes a colour, an icon, or a label. Reduced motion (`globals.css`, HON-470) collapses every animation and transition to 0.01ms. `animate-spin` is the one exemption and keeps spinning, because a frozen spinner no longer says "loading".

The mechanical part is a grep. It must return nothing:

```bash
grep -rnE "transition-all|ease-in([\"' ]|$)|duration-([4-9][0-9]{2}|[0-9]{4,})" src --include='*.tsx' | grep -v '\.stories\.\|\.test\.'
```

## Imagery

The product supplies one piece of content imagery: a generated illustration of each meal. Photos a user attaches themselves (the recipe photos in `AttachImages`) are their input, not our imagery, and these rules do not cover them. The illustration is decoration. The meal name, ingredients, and steps carry everything the user needs, so the image never carries information and never gets in the way. It also gives each meal a colour: the card and hero take a tint from the food in the picture, so a week of meals reads as a week of different dishes before anyone reads a name. Decided in HON-726 (the image) and HON-743 (the hue, the tinted surface, and the blend).

- **One style, one source.** The only content imagery is the generated meal illustration, produced by the single prompt in `src/lib/meal-images/prompt.ts`: V4, a warm, stylised, gouache-like illustration of one serving of the finished dish on a pure white, flat surface, the plate taking about half the width of a 3:2 frame with empty space on every side. No stock photos, no second illustration style, no hand-placed decorative images, and no AI imagery anywhere else in the product. A second style or source is a second visual language the rest of the guide was not written for. The white surface is load-bearing: it is what lets the image blend into a tinted card (below).
- **Meal hue.** Every meal with an image has an `imageHue`: an integer from 0 to 360, the OKLCH hue of its food, extracted once when the image is generated and stored on the meal. It is the **only** per-meal colour variable. Lightness and chroma are never per meal, and nothing else about the meal (type, cuisine, tags) picks a colour. Components receive it as the `--meal-hue` CSS variable.
- **Tinted surfaces.** A meal card and the modal hero take their background from `oklch(L C var(--meal-hue))`, with L and C fixed tokens:

  | Token                            | Light                              | Dark                               |
  | -------------------------------- | ---------------------------------- | ---------------------------------- |
  | Surface                          | L 0.97, C 0.035                    | L 0.35, C 0.035                    |
  | Text on a tinted surface         | `oklch(0.25 0.03 var(--meal-hue))` | `oklch(0.95 0.02 var(--meal-hue))` |
  | Muted text on a tinted surface   | `oklch(0.48 0.03 var(--meal-hue))` | `oklch(0.78 0.02 var(--meal-hue))` |
  | Accent chip (text: the text row) | L 0.90, C 0.11                     | L 0.27, C 0.11                     |

  The values live as `--meal-*-l` / `--meal-*-c` tokens in `globals.css`, and `[data-meal-surface]` there re-scopes the theme tokens (`card`, `foreground`, `muted-foreground`, and `secondary` / `accent` as the chip) on the element that carries `--meal-hue`, so everything already inside a card uses the tinted values without a variant of its own. `src/lib/meal-tint.test.ts` measures every pairing against all 360 hues: the text and muted rows and the theme's `success`, `warning` and `primary` at ≥4.5:1 on the surface, and the chip at ≥5:1 like the status pairings. The dark surface is L 0.35, not the 0.45 the HON-743 contact sheet started from: at 0.45 the dark `success` / `warning` ingredient colours and the muted text fall below 4.5:1. The cost is that `multiply` on a dark surface darkens the food too, so in dark mode the image reads as a dim shape in the tint instead of a bright plate. That is acceptable for decoration, and a lighter surface would buy it back only by failing contrast. Fixed L and C are the point: every meal gets the same contrast, so one number is measured and tuned for all meals instead of one per dish, and no hue can produce an unreadable card. Text and chips on a tinted surface use these tokens, not the neutral `foreground` or `muted-foreground` values, which are calibrated for the neutral background (see [Color](#color)).

- **The image on a surface.** Rendered through `next/image` with `object-fit: cover` and `mix-blend-mode: multiply`, so the white surface of the illustration takes the tint and the plate sits on the card rather than in a white box. A `mask-image` linear fade blends its edge into the surface:
  - **Cards:** the image sits on the right at about 62% of the card width (45% below `sm`), and the fade runs left to right, reaching full opacity at 70% of the image width. The text sits on the plain tint to its left, and the title is capped in width so it wraps before it reaches the image. A card with actions at the right end of its title row (the planner card's Note and menu) reserves that column: the image ends before the actions, so nothing the user reads or taps sits on the opaque illustration (`trailingActions` on `MealImageCard`, HON-749).
  - **Modal hero:** 3:2, the full width of the dialog content, first element of `MealDetail` (below the title and the note, above the description). The fade runs bottom-up into the content below.

  No border, no shadow, and no radius on the image itself: the card or hero clips it. A hard edge, a frame, or an un-blended white rectangle turns the illustration back into a photo pasted on a card.

- **Absence renders the neutral card.** A meal without an image (no image, or no `imageHue`) renders the ordinary neutral card and hero: no tint, no image element, no placeholder, icon, skeleton, or shimmer. A placeholder tells the user something is missing when nothing is. The one exception is the hero while `imageStatus` is `generating`: a plain `bg-muted` 3:2 box holds the space so the content does not jump when the image lands. The box has no animation and no icon. Cards show nothing extra while generating.
- **Arrival is a fade.** The image fades in on load with `transition-opacity duration-200 ease-out` — the overlay duration and house easing from [Motion](#motion). Nothing else moves. On the hero the reserved box already holds the space. On a card the tint and text colours come from `imageHue`, which is stored with the image, so they are in place from the first render and only the image fades in.
- **Alt text is the meal name.** Nothing more — not "Illustration of …". A screen reader already announces it as an image, and the name is the only fact the picture adds.
- **Errors are silent.** A failed or unavailable image never produces a toast or error UI; the card or modal renders as if the meal had no image. The image is decoration and must not interrupt cooking.
- **Where.** Meal cards wherever they appear (the planner, alternatives, the household meal list, imagine results) and the modal hero. Not on ingredient rows, shopping lists, pantry items, or empty states: those are about ingredients and tasks, not dishes.

## Composition rules

Each of these came from a review that found the opposite in production.

- **Headings divide, borders contain.** Group items under a heading, not inside a bordered wrapper. The only bordered elements in a list are the interactive items themselves (`HON-386`).
- **No cards inside cards.** If a `Card` needs internal grouping, use spacing and a section heading (`HON-386`).
- **Actions sit on the title row.** A card's actions align right on the same line as its name, in one row, never as a footer strip or stacked buttons (`HON-378`, `HON-383`).
- **Labels sit outside the card.** Context labels like the meal type ("Dinner") go above the card as a caption, not inside it (`HON-379`).
- **Content is not sticky.** Action bars live inline at the end of the content they act on. The only fixed chrome is the header and the mobile tab bar (`HON-380`). They stay put when a Radix overlay locks page scroll only because `globals.css` sets `scrollbar-gutter: stable` on `html` and zeroes the lock's body margin — keep both (`HON-690`).
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
- Gradients, glows, blurred blobs, glass effects, colored side rails, decorative shadows (the `mask-image` fade that blends a meal image into its surface excepted)
- Decorative icons or illustrations in empty states
- An eyebrow label in all caps above every heading
- Centered hero plus a three-card grid for anything that is not the landing page
- Three or more buttons of equal weight in one row. One primary, the rest `outline` or `ghost`
- A screen's primary action rendered at `size="sm"`
- Playful copy on more than one element per screen
- A theme or language toggle placed in the header
- `transition-all`, `ease-in`, or a transition or one-shot animation longer than 300ms inside the app (looping spinners and skeletons excepted)
- An entrance, bounce, or stagger on something done many times a session (ticking an item, toggling a staple), or a staged reveal of AI output
- Motion as the only sign that something changed: a state that is visible only while its animation runs
- A placeholder, icon, skeleton, or shimmer for a missing meal image (the plain `bg-muted` box while `imageStatus` is `generating` excepted)
- Stock or decorative photography
- A second image style alongside the generated meal illustration
- A meal image framed as a photo: hard-edged, bordered, or un-blended on a tinted surface

## Open questions for review

Add one here when a review finds code and rule disagreeing and the fix is not obvious.

1. The Body level has no wrapping variant. `Body variant="small"` is `leading-none`, so it is only safe for single-line items; multi-line text currently falls back to `muted`. Options: add a `body` variant (`text-sm leading-normal`) or loosen `small`. Still open — HON-606 shipped `Heading`'s `as` prop without taking a position on this, since it needs a design call rather than a mechanical change.

## Pending code changes

Decisions above that the code does not yet reflect. Each has a Linear issue; update this list when one ships.

None at the moment.
