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
 *   profile so subsequent events on the same render auto-attach correctly
 *   without waiting for a layout re-render + identify.
 *
 * - `is_first`: for events configured in `FIRST_PROPERTY_FOR`, the wrapper
 *   reads the corresponding `first_*_at` person property. If unset, fires the
 *   event with `is_first: true` and `$set_once`-es the timestamp on the same
 *   capture call (durable across sessions). If set, fires with
 *   `is_first: false`. Callers do not pass `is_first`. Activation funnels
 *   filter `is_first: true`.
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
  'meal_plan:meal_swapped': {
    plan_id: string
    from_meal_id: string
    to_meal_id: string
    source: Source
  }
  'meal_plan:meal_skipped': { plan_id: string; meal_id: string; source: Source }
  'meal:imagined': { meal_id: string; source: Source }
  'recipe:imported': { source: Source }
  'pantry:item_added': { source: Source }
  'shopping:item_purchased': { source: Source }
  /** `item_count` is the number of lines written to the clipboard — a count, never item names. */
  'shopping:list_copied': { source: Source; item_count: number }
}

export type EventName = keyof EventPayload

/**
 * Events whose first occurrence sets a `first_*_at` person property via
 * `$set_once`. The wrapper reads the property to attach `is_first` and writes
 * it on the first capture.
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
    if (firstPropertyKey) {
      const existing = posthog.get_property(firstPropertyKey)
      if (existing) {
        merged.is_first = false
      } else {
        merged.is_first = true
        merged.$set_once = { [firstPropertyKey]: new Date().toISOString() }
      }
    }

    // The one event that establishes household membership: $set the id on
    // the person profile so subsequent events auto-attach without waiting
    // for the next layout render + identify.
    if (name === 'onboarding:household_created') {
      const householdId = (props as EventPayload['onboarding:household_created']).household_id
      merged.$set = {
        ...(merged.$set as Record<string, unknown> | undefined),
        household_id: householdId,
      }
    }

    posthog.capture(name, merged)
  } catch {
    // Swallow — capture must never break a user flow.
  }
}
