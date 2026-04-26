import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { track } from '@/lib/analytics'

// Hoisted mock — vi.mock factories run before top-level `const` bindings.
// Mirrors the pattern in PostHogProvider.test.tsx.
const { posthogMock } = vi.hoisted(() => ({
  posthogMock: {
    __loaded: true,
    capture: vi.fn(),
    get_property: vi.fn(),
  },
}))

vi.mock('posthog-js', () => ({ default: posthogMock }))

beforeEach(() => {
  posthogMock.__loaded = true
  posthogMock.capture.mockReset()
  posthogMock.get_property.mockReset()
})

afterEach(() => {
  posthogMock.capture.mockReset()
  posthogMock.get_property.mockReset()
})

describe('track()', () => {
  it('fires posthog.capture with the event name and an empty props object', async () => {
    await track('auth:sign_up', {})

    expect(posthogMock.capture).toHaveBeenCalledTimes(1)
    expect(posthogMock.capture).toHaveBeenCalledWith('auth:sign_up', {})
  })

  it('auto-attaches household_id from $stored_person_properties', async () => {
    posthogMock.get_property.mockImplementation((key: string) => {
      if (key === '$stored_person_properties') return { household_id: 'hh-42' }
      return undefined
    })

    await track('recipe:imported', { source: 'import_page' })

    expect(posthogMock.capture).toHaveBeenCalledTimes(1)
    expect(posthogMock.capture).toHaveBeenCalledWith('recipe:imported', {
      household_id: 'hh-42',
      source: 'import_page',
    })
  })

  it('does not attach household_id when person properties are missing', async () => {
    posthogMock.get_property.mockReturnValue(undefined)

    await track('pantry:item_added', { source: 'pantry_inline' })

    expect(posthogMock.capture).toHaveBeenCalledTimes(1)
    const props = posthogMock.capture.mock.calls[0]?.[1] as Record<string, unknown>
    expect(props).not.toHaveProperty('household_id')
    expect(props).toEqual({ source: 'pantry_inline' })
  })

  it('attaches is_first: true and $set_once on the first plan_generated', async () => {
    posthogMock.get_property.mockImplementation((key: string) => {
      if (key === '$stored_person_properties') return { household_id: 'hh-1' }
      if (key === 'first_plan_generated_at') return undefined
      return undefined
    })

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
    posthogMock.get_property.mockImplementation((key: string) => {
      if (key === 'first_plan_generated_at') return '2026-04-01T00:00:00.000Z'
      return undefined
    })

    await track('meal_plan:plan_generated', { plan_id: 'p2' })

    expect(posthogMock.capture).toHaveBeenCalledTimes(1)
    const props = posthogMock.capture.mock.calls[0]?.[1] as Record<string, unknown>
    expect(props.is_first).toBe(false)
    expect(props).not.toHaveProperty('$set_once')
  })

  it('attaches is_first independently for plan_generated vs meal_completed', async () => {
    posthogMock.get_property.mockImplementation((key: string) => {
      if (key === 'first_plan_generated_at') return '2026-04-01T00:00:00.000Z'
      if (key === 'first_meal_completed_at') return undefined
      return undefined
    })

    await track('meal_plan:meal_completed', { plan_id: 'p1', meal_id: 'm1', source: 'meal_card' })

    const props = posthogMock.capture.mock.calls[0]?.[1] as Record<string, unknown>
    expect(props.is_first).toBe(true)
    expect((props.$set_once as Record<string, unknown>).first_meal_completed_at).toBeDefined()
  })

  it('does not attach is_first to events without a configured first-property', async () => {
    await track('meal_plan:meal_swapped', {
      plan_id: 'p1',
      from_meal_id: 'm1',
      to_meal_id: 'm2',
      source: 'meal_selector',
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
    posthogMock.get_property.mockImplementation((key: string) => {
      if (key === '$stored_person_properties') return { household_id: 'hh-stale' }
      return undefined
    })

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
    await expect(
      track('shopping:item_purchased', { source: 'shopping_list' }),
    ).resolves.toBeUndefined()
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
