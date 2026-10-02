/**
 * Typed product-analytics wrapper around `posthog.capture()`.
 *
 * Single entry point for product events: `track(name, props)`. The discriminated
 * union below is the canonical event registry — every product event flows
 * through this file. Raw `posthog.capture()` is reserved for the SDK itself
 * (`PostHogProvider` and `posthog-server`).
 *
 * ## Naming convention: `category:object_action_past`
 *
 * Snake_case, namespace-prefixed, past tense. Categories are a closed enum
 * (`auth`, `onboarding`, `meal_plan`, `meal`, `recipe`, `pantry`, `shopping`;
 * `ai` reserved for HON-475).
 *
 * **Why past tense, not present (PostHog's documented recommendation):**
 *
 * Events fire in `onSuccess` after the action resolves, so past tense matches
 * what the wrapper sees ("the meal got completed", not "complete the meal").
 * Mixpanel, Amplitude, Heap, Snowplow, and most canonical Segment examples use
 * past tense; PostHog's own autocaptured events (`$pageview`, `$pageleave`,
 * `$identify`, `$feature_flag_called`, `$exception`) are past-tense or
 * noun-form and contradict their own style guide. Past tense also disambiguates
 * verb vs adjective — `completed` is unambiguously a verb; `complete` reads
 * either way. Important when event names appear stripped of context (alerts,
 * CSV exports, warehouse columns).
 *
 * **Future agents and code review (`/branch-review` or `/code-review`):** this divergence is intentional. Do not
 * "fix" event names back to PostHog's documented present-tense recommendation.
 * Renaming events orphans historical funnels — much more expensive than
 * inheriting a deliberate convention.
 *
 * **Carve-out:** `auth:sign_up` is the one short-form intransitive event (no
 * `signed_up_user` redundancy). All other events use `category:object_action_past`.
 *
 * ## Auto-attached properties (not passed by callers)
 *
 * - `household_id`: read from PostHog person properties (set by HON-474's
 *   `posthog.identify(userId, { household_id })` in `PostHogProvider.tsx`).
 *   Callers do not pass it. The one exception is `onboarding:household_created`
 *   — the source-of-truth event that establishes the household; its caller
 *   passes the new id and the wrapper additionally `$set`s it on the person
 *   profile server side. That `$set` does not update the person properties
 *   stored on the client, so later events carry `household_id` only after the
 *   next layout render re-runs `identify` with it.
 *
 * - `is_first`: for events configured in `FIRST_PROPERTY_FOR`, the wrapper
 *   reads the corresponding `first_*_at` key from posthog-js persistence. If
 *   unset, fires the event with `is_first: true`, `$set_once`-es the timestamp
 *   on the same capture call (the server-side person property), and
 *   `register_once`-s it locally. The local write is what the next read sees:
 *   a `$set_once` on capture goes to the server only and never comes back to
 *   persistence (HON-991). If set, fires with `is_first: false`. Callers do
 *   not pass `is_first`. Activation funnels filter `is_first: true`.
 *
 *   `register_once` stores a super property, so from then on posthog-js
 *   attaches `first_*_at` to every event from this browser, as an event
 *   property with the same name as the person property. That is deliberate:
 *   the marker lives with the rest of PostHog's identity state, so `reset()`
 *   clears it together with the distinct id. Sign-out calls `reset()`, and
 *   `PostHogProvider` calls it before `identify` when the browser is still
 *   identified as a different user, so one user never inherits another's
 *   marker. Activation insights filter on `is_first` or on the person
 *   property, never on the event property.
 *
 *   Persistence is per browser, so a user's first activation event on a second
 *   device (or after sign-out) carries `is_first: true` again. That is
 *   accepted; the person property's `$set_once` keeps the original timestamp
 *   regardless.
 *
 * ## PII
 *
 * Inherits HON-474 Decision 10 (universal PII policy). `PostHogProvider`'s
 * `before_send` hook runs `sanitizeEventProperties` on every event, so this
 * wrapper does not re-sanitize. Keep props clean by convention; the sanitizer
 * is a backstop, not the primary defence. Never include free-text, email,
 * tokens, or names in event props.
 *
 * ## Versioning
 *
 * When a property's *meaning* changes (e.g., `Source` adds a new value with
 * different semantics, `MealType` changes), ship `category:object_action_v2`
 * and keep the old event firing for one release cycle so historical funnels
 * remain comparable. Note the supersedes relationship in this file.
 *
 * @see HON-476 for the design decisions behind this taxonomy.
 */

/** Closed enum of UI surfaces an event can originate from. Adding a value is a code change, not a string typo. */
export type Source =
  | 'meal_card'
  | 'meal_selector'
  | 'timeline'
  | 'imagine_page'
  | 'import_page'
  | 'pantry_inline'
  | 'shopping_list'
  | 'cook_view'

/** Meal-type literal union. Mirrors `@/generated/prisma/enums.MealType` but kept local so the analytics module has no DB import. */
export type MealType = 'breakfast' | 'lunch' | 'dinner' | 'snack'

/**
 * Caller payload per event name. The wrapper auto-attaches `household_id`
 * (from person properties) and `is_first` (for events in `FIRST_PROPERTY_FOR`)
 * — callers do not include those keys.
 *
 * `onboarding:household_created` is the one event whose caller passes
 * `household_id` explicitly: it is the source-of-truth event that establishes
 * the household for the rest of the session.
 */
export type EventPayload = {
  'auth:sign_up': Record<string, never>
  'onboarding:household_created': { household_id: string }
  'meal_plan:plan_generated': { plan_id: string }
  'meal_plan:meal_completed': { plan_id: string; meal_id: string; source: Source }
  /**
   * The household replaced the meal on a planned entry. Fires from both ways
   * the selector can do that, told apart by `via` rather than by a new
   * `Source` value (HON-890).
   */
  'meal_plan:meal_swapped': {
    plan_id: string
    from_meal_id: string
    to_meal_id: string
    source: Source
    /**
     * True when the household picked the meal already on the entry. Search and
     * "my recipes" browse list it, so the PATCH is a no-op write rather than a
     * swap. Kept as an event rather than dropped: it records that the
     * alternatives were not better than the plan. Exclude it from the swap
     * funnel with `is_reselect = false` (HON-708).
     */
    is_reselect: boolean
    /**
     * How the new meal was chosen. `library`: picked from the alternatives,
     * search or My recipes list. `imagine`: a meal the AI wrote in the
     * selector, which also fires `meal:imagined` (HON-890).
     */
    via: 'library' | 'imagine'
  }
  'meal_plan:meal_skipped': { plan_id: string; meal_id: string; source: Source }
  'meal:imagined': { meal_id: string; source: Source }
  'recipe:imported': { source: Source }
  'pantry:item_added': { source: Source }
  'shopping:item_purchased': { source: Source }
  /** `item_count` is the number of lines written to the clipboard — a count, never item names. */
  'shopping:list_copied': { source: Source; item_count: number }
  /**
   * The cook sent a question about one step in the cook view (HON-969). Fires
   * on send, not on the answer. `source` says whether it was a chip or typed.
   */
  'cook_view:question_asked': {
    plan_id: string
    meal_id: string
    step_index: number
    source: 'chip' | 'text'
  }
}

export type EventName = keyof EventPayload

/**
 * Events whose first occurrence sets a `first_*_at` person property via
 * `$set_once`. The wrapper reads the key from local persistence to attach
 * `is_first`, and on the first capture writes it both server side
 * (`$set_once`) and locally (`register_once`).
 */
const FIRST_PROPERTY_FOR: Partial<Record<EventName, string>> = {
  'meal_plan:plan_generated': 'first_plan_generated_at',
  'meal_plan:meal_completed': 'first_meal_completed_at',
}

/**
 * Capture a product event. Returns `Promise<void>`; never throws.
 *
 * Lazy-imports `posthog-js` so this module stays out of any chunk that hasn't
 * already paid for the SDK (matches the pattern in `src/lib/errors-client.ts`).
 * No-ops when consent is missing, env is unset, or PostHog hasn't finished
 * initialising — `posthog.__loaded` is the canonical guard.
 *
 * Callers fire-and-forget by prefixing with `void`:
 *   `void track('meal_plan:meal_completed', { ... })`.
 */
export async function track<K extends EventName>(name: K, props: EventPayload[K]): Promise<void> {
  if (typeof window === 'undefined') return

  try {
    const { default: posthog } = await import('posthog-js')
    if (!posthog.__loaded) return

    const merged: Record<string, unknown> = {}

    // Auto-attach household_id from person properties (set by identify).
    const stored = posthog.get_property('$stored_person_properties')
    if (stored && typeof stored === 'object') {
      const value = (stored as Record<string, unknown>).household_id
      if (typeof value === 'string') merged.household_id = value
    }

    // Caller-supplied props win over auto-attached.
    Object.assign(merged, props)

    // Auto-attach is_first + $set_once for activation events.
    const firstPropertyKey = FIRST_PROPERTY_FOR[name]
    let firstAt: string | undefined
    if (firstPropertyKey) {
      const existing = posthog.get_property(firstPropertyKey)
      if (existing) {
        merged.is_first = false
      } else {
        firstAt = new Date().toISOString()
        merged.is_first = true
        merged.$set_once = { [firstPropertyKey]: firstAt }
      }
    }

    // The one event that establishes household membership: $set the id on
    // the person profile server side. Later events pick it up only after the
    // next layout render re-runs identify (see the header comment).
    if (name === 'onboarding:household_created') {
      const householdId = (props as EventPayload['onboarding:household_created']).household_id
      merged.$set = {
        ...(merged.$set as Record<string, unknown> | undefined),
        household_id: householdId,
      }
    }

    posthog.capture(name, merged)

    // `$set_once` never reaches local persistence, so write the key there
    // too, or the next get_property read is empty again (HON-991).
    if (firstPropertyKey && firstAt) {
      posthog.register_once({ [firstPropertyKey]: firstAt })
    }
  } catch {
    // Swallow — capture must never break a user flow.
  }
}
