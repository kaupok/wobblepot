import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { track } from '@/lib/analytics'

// Hoisted mock — vi.mock factories run before top-level `const` bindings.
// Mirrors the pattern in PostHogProvider.test.tsx.
//
// `get_property` and `register_once` share one map, the way posthog-js
// persistence does: `register_once` writes keys that are not yet set, and
// `get_property` reads them. `capture` deliberately does not write to it,
// because a `$set_once` on capture never reaches local persistence (HON-991).
const { posthogMock, persistence } = vi.hoisted(() => {
  const persistence = new Map<string, unknown>()
  return {
    persistence,
    posthogMock: {
      __loaded: true,
      capture: vi.fn(),
      get_property: vi.fn((key: string) => persistence.get(key)),
      register_once: vi.fn((props: Record<string, unknown>) => {
        for (const [key, value] of Object.entries(props)) {
          if (!persistence.has(key)) persistence.set(key, value)
        }
      }),
    },
  }
})

vi.mock('posthog-js', () => ({ default: posthogMock }))

function lastCaptureProps(): Record<string, unknown> {
  return posthogMock.capture.mock.lastCall?.[1] as Record<string, unknown>
}

beforeEach(() => {
  posthogMock.__loaded = true
  persistence.clear()
})

afterEach(() => {
  posthogMock.capture.mockReset()
  posthogMock.get_property.mockClear()
  posthogMock.register_once.mockClear()
})

describe('track()', () => {
  it('fires posthog.capture with the event name and an empty props object', async () => {
    await track('auth:sign_up', {})

    expect(posthogMock.capture).toHaveBeenCalledTimes(1)
    expect(posthogMock.capture).toHaveBeenCalledWith('auth:sign_up', {})
  })

  it('auto-attaches household_id from $stored_person_properties', async () => {
    persistence.set('$stored_person_properties', { household_id: 'hh-42' })

    await track('recipe:imported', { source: 'import_page' })

    expect(posthogMock.capture).toHaveBeenCalledTimes(1)
    expect(posthogMock.capture).toHaveBeenCalledWith('recipe:imported', {
      household_id: 'hh-42',
      source: 'import_page',
    })
  })

  it('does not attach household_id when person properties are missing', async () => {
    await track('pantry:item_added', { source: 'pantry_inline' })

    expect(posthogMock.capture).toHaveBeenCalledTimes(1)
    const props = posthogMock.capture.mock.calls[0]?.[1] as Record<string, unknown>
    expect(props).not.toHaveProperty('household_id')
    expect(props).toEqual({ source: 'pantry_inline' })
  })

  it('attaches is_first: true and $set_once on the first plan_generated', async () => {
    persistence.set('$stored_person_properties', { household_id: 'hh-1' })

    await track('meal_plan:plan_generated', { plan_id: 'p1' })

    expect(posthogMock.capture).toHaveBeenCalledTimes(1)
    const [name, props] = posthogMock.capture.mock.calls[0] ?? []
    expect(name).toBe('meal_plan:plan_generated')
    const p = props as Record<string, unknown>
    expect(p.household_id).toBe('hh-1')
    expect(p.plan_id).toBe('p1')
    expect(p.is_first).toBe(true)
    const setOnce = p.$set_once as Record<string, unknown>
    expect(setOnce).toBeDefined()
    expect(typeof setOnce.first_plan_generated_at).toBe('string')
    // ISO timestamp shape — quick sanity, not exact value.
    expect(setOnce.first_plan_generated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('attaches is_first: false (no $set_once) when first_plan_generated_at is already set', async () => {
    persistence.set('first_plan_generated_at', '2026-04-01T00:00:00.000Z')

    await track('meal_plan:plan_generated', { plan_id: 'p2' })

    expect(posthogMock.capture).toHaveBeenCalledTimes(1)
    const props = posthogMock.capture.mock.calls[0]?.[1] as Record<string, unknown>
    expect(props.is_first).toBe(false)
    expect(props).not.toHaveProperty('$set_once')
  })

  it('attaches is_first independently for plan_generated vs meal_completed', async () => {
    persistence.set('first_plan_generated_at', '2026-04-01T00:00:00.000Z')

    await track('meal_plan:meal_completed', { plan_id: 'p1', meal_id: 'm1', source: 'meal_card' })

    const props = posthogMock.capture.mock.calls[0]?.[1] as Record<string, unknown>
    expect(props.is_first).toBe(true)
    expect((props.$set_once as Record<string, unknown>).first_meal_completed_at).toBeDefined()
  })

  it('sends is_first: true then false on two plan_generated calls in a row', async () => {
    await track('meal_plan:plan_generated', { plan_id: 'p1' })
    const first = lastCaptureProps()
    await track('meal_plan:plan_generated', { plan_id: 'p2' })
    const second = lastCaptureProps()

    expect(posthogMock.capture).toHaveBeenCalledTimes(2)
    expect(first.is_first).toBe(true)
    expect(first).toHaveProperty('$set_once')
    expect(second.is_first).toBe(false)
    expect(second).not.toHaveProperty('$set_once')
  })

  it('writes the same timestamp locally that it $set_once-s on the server', async () => {
    await track('meal_plan:meal_completed', { plan_id: 'p1', meal_id: 'm1', source: 'meal_card' })

    const setOnce = lastCaptureProps().$set_once as Record<string, unknown>
    expect(posthogMock.register_once).toHaveBeenCalledTimes(1)
    expect(posthogMock.register_once).toHaveBeenCalledWith({
      first_meal_completed_at: setOnce.first_meal_completed_at,
    })
  })

  it('stores the key as a super property only after the first capture', async () => {
    // register_once writes posthog-js's super-property store, so the real SDK
    // attaches the key to every later event (documented in analytics.ts). The
    // first event itself must not carry it: it goes out before the write.
    await track('meal_plan:plan_generated', { plan_id: 'p1' })

    expect(lastCaptureProps()).not.toHaveProperty('first_plan_generated_at')
    expect(posthogMock.register_once.mock.invocationCallOrder[0]).toBeGreaterThan(
      posthogMock.capture.mock.invocationCallOrder[0] ?? Infinity,
    )
    expect(persistence.get('first_plan_generated_at')).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('keeps the plan_generated and meal_completed guards independent across calls', async () => {
    await track('meal_plan:plan_generated', { plan_id: 'p1' })
    await track('meal_plan:meal_completed', { plan_id: 'p1', meal_id: 'm1', source: 'meal_card' })
    const firstCompletion = lastCaptureProps()
    await track('meal_plan:meal_completed', { plan_id: 'p1', meal_id: 'm2', source: 'meal_card' })
    const secondCompletion = lastCaptureProps()

    expect(firstCompletion.is_first).toBe(true)
    expect(secondCompletion.is_first).toBe(false)
  })

  it('does not write persistence when the event already has its first-property', async () => {
    persistence.set('first_plan_generated_at', '2026-04-01T00:00:00.000Z')

    await track('meal_plan:plan_generated', { plan_id: 'p2' })

    expect(posthogMock.register_once).not.toHaveBeenCalled()
    expect(persistence.get('first_plan_generated_at')).toBe('2026-04-01T00:00:00.000Z')
  })

  it('does not attach is_first to events without a configured first-property', async () => {
    await track('meal_plan:meal_swapped', {
      plan_id: 'p1',
      from_meal_id: 'm1',
      to_meal_id: 'm2',
      source: 'meal_selector',
      is_reselect: false,
      via: 'library',
    })

    const props = posthogMock.capture.mock.calls[0]?.[1] as Record<string, unknown>
    expect(props).not.toHaveProperty('is_first')
    expect(props).not.toHaveProperty('$set_once')
  })

  it('$set-s household_id on the person profile for onboarding:household_created', async () => {
    await track('onboarding:household_created', { household_id: 'hh-new' })

    expect(posthogMock.capture).toHaveBeenCalledTimes(1)
    const props = posthogMock.capture.mock.calls[0]?.[1] as Record<string, unknown>
    expect(props.household_id).toBe('hh-new')
    expect(props.$set).toEqual({ household_id: 'hh-new' })
  })

  it('caller-supplied household_id overrides the auto-attached value', async () => {
    persistence.set('$stored_person_properties', { household_id: 'hh-stale' })

    await track('onboarding:household_created', { household_id: 'hh-fresh' })

    const props = posthogMock.capture.mock.calls[0]?.[1] as Record<string, unknown>
    expect(props.household_id).toBe('hh-fresh')
    expect(props.$set).toEqual({ household_id: 'hh-fresh' })
  })

  it('no-ops when posthog has not finished initialising', async () => {
    posthogMock.__loaded = false

    await track('meal:imagined', { meal_id: 'm1', source: 'imagine_page' })

    expect(posthogMock.capture).not.toHaveBeenCalled()
  })

  it('swallows errors thrown by posthog.capture without re-throwing', async () => {
    posthogMock.capture.mockImplementation(() => {
      throw new Error('boom')
    })

    // track() returns Promise<void> and swallows errors internally — neither
    // the synchronous call nor the awaited promise should throw.
    await expect(track('pantry:item_added', { source: 'pantry_inline' })).resolves.toBeUndefined()
  })

  /**
   * TypeScript-error guards. These lines compile only because of the
   * `@ts-expect-error` directives — if the typed signature of `track()`
   * regressed (became too permissive), `tsc` would flag the directive as
   * unused and the build would fail. Runtime assertion is irrelevant here;
   * the test exists to bind the type contract to CI.
   */
  it('rejects unknown event names, missing props, and out-of-set values at compile time', () => {
    // @ts-expect-error — unknown event name
    track('foo:bar', {})
    // @ts-expect-error — missing required `plan_id`
    track('meal_plan:plan_generated', {})
    // @ts-expect-error — out-of-set `source` literal
    track('recipe:imported', { source: 'invalid_source' })
    // @ts-expect-error — extraneous prop on a Record<string, never> event
    track('auth:sign_up', { unexpected: 'prop' })

    expect(true).toBe(true)
  })
})
