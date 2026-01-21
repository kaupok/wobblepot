import { describe, it, expect } from 'vitest'
import {
  getDefaultCalories,
  getDefaultProtein,
  getEffectiveCalories,
  getEffectiveProtein,
  getHouseholdAggregate,
} from './nutrition-defaults'
import type { Member, MemberPreferences } from '@/types/member'

describe('nutrition-defaults', () => {
  describe('getDefaultCalories', () => {
    it('returns 2000 for 1x portion', () => {
      expect(getDefaultCalories(1.0)).toBe(2000)
    })

    it('returns scaled value for smaller portion', () => {
      expect(getDefaultCalories(0.75)).toBe(1500)
    })

    it('returns scaled value for larger portion', () => {
      expect(getDefaultCalories(1.5)).toBe(3000)
    })

    it('rounds to nearest integer', () => {
      expect(getDefaultCalories(0.33)).toBe(660)
    })
  })

  describe('getDefaultProtein', () => {
    it('returns 50 for 1x portion', () => {
      expect(getDefaultProtein(1.0)).toBe(50)
    })

    it('returns scaled value for smaller portion', () => {
      expect(getDefaultProtein(0.75)).toBe(38)
    })

    it('returns scaled value for larger portion', () => {
      expect(getDefaultProtein(1.5)).toBe(75)
    })
  })

  describe('getEffectiveCalories', () => {
    it('returns custom value when set', () => {
      const prefs: MemberPreferences = {
        displayName: null,
        portionMultiplier: 1.0,
        targetCalories: 2500,
        targetProtein: null,
        targetCarbs: null,
        targetFat: null,
        dietaryType: null,
        allergens: [],
        restrictions: [],
        excludedIngredients: [],
        excludedIngredientIds: [],
      }
      expect(getEffectiveCalories(prefs)).toEqual({ value: 2500, isDefault: false })
    })

    it('returns default when not set', () => {
      const prefs: MemberPreferences = {
        displayName: null,
        portionMultiplier: 1.0,
        targetCalories: null,
        targetProtein: null,
        targetCarbs: null,
        targetFat: null,
        dietaryType: null,
        allergens: [],
        restrictions: [],
        excludedIngredients: [],
        excludedIngredientIds: [],
      }
      expect(getEffectiveCalories(prefs)).toEqual({ value: 2000, isDefault: true })
    })

    it('returns default for null preferences', () => {
      expect(getEffectiveCalories(null)).toEqual({ value: 2000, isDefault: true })
    })

    it('scales default by portion multiplier', () => {
      const prefs: MemberPreferences = {
        displayName: null,
        portionMultiplier: 0.75,
        targetCalories: null,
        targetProtein: null,
        targetCarbs: null,
        targetFat: null,
        dietaryType: null,
        allergens: [],
        restrictions: [],
        excludedIngredients: [],
        excludedIngredientIds: [],
      }
      expect(getEffectiveCalories(prefs)).toEqual({ value: 1500, isDefault: true })
    })
  })

  describe('getEffectiveProtein', () => {
    it('returns custom value when set', () => {
      const prefs: MemberPreferences = {
        displayName: null,
        portionMultiplier: 1.0,
        targetCalories: null,
        targetProtein: 100,
        targetCarbs: null,
        targetFat: null,
        dietaryType: null,
        allergens: [],
        restrictions: [],
        excludedIngredients: [],
        excludedIngredientIds: [],
      }
      expect(getEffectiveProtein(prefs)).toEqual({ value: 100, isDefault: false })
    })

    it('returns default when not set', () => {
      const prefs: MemberPreferences = {
        displayName: null,
        portionMultiplier: 1.0,
        targetCalories: null,
        targetProtein: null,
        targetCarbs: null,
        targetFat: null,
        dietaryType: null,
        allergens: [],
        restrictions: [],
        excludedIngredients: [],
        excludedIngredientIds: [],
      }
      expect(getEffectiveProtein(prefs)).toEqual({ value: 50, isDefault: true })
    })

    it('returns default for null preferences', () => {
      expect(getEffectiveProtein(null)).toEqual({ value: 50, isDefault: true })
    })
  })

  describe('getHouseholdAggregate', () => {
    const createMember = (id: string, preferences: MemberPreferences | null): Member => ({
      id,
      userId: null,
      name: null,
      role: 'member',
      joinedAt: new Date().toISOString(),
      user: null,
      preferences,
      invite: null,
    })

    const createPrefs = (
      portionMultiplier: number,
      targetCalories: number | null,
      targetProtein: number | null,
    ): MemberPreferences => ({
      displayName: null,
      portionMultiplier,
      targetCalories,
      targetProtein,
      targetCarbs: null,
      targetFat: null,
      dietaryType: null,
      allergens: [],
      restrictions: [],
      excludedIngredients: [],
      excludedIngredientIds: [],
    })

    it('returns zeros for empty member list', () => {
      expect(getHouseholdAggregate([])).toEqual({
        totalCalories: 0,
        totalProtein: 0,
        memberCount: 0,
        defaultCount: 0,
      })
    })

    it('sums up custom values', () => {
      const members: Member[] = [
        createMember('1', createPrefs(1.0, 2000, 100)),
        createMember('2', createPrefs(1.0, 1800, 80)),
      ]
      expect(getHouseholdAggregate(members)).toEqual({
        totalCalories: 3800,
        totalProtein: 180,
        memberCount: 2,
        defaultCount: 0,
      })
    })

    it('uses defaults for members without custom values', () => {
      const members: Member[] = [
        createMember('1', createPrefs(1.0, null, null)), // defaults: 2000, 50
        createMember('2', createPrefs(0.75, null, null)), // defaults: 1500, 38
      ]
      expect(getHouseholdAggregate(members)).toEqual({
        totalCalories: 3500,
        totalProtein: 88,
        memberCount: 2,
        defaultCount: 2,
      })
    })

    it('mixes custom and default values', () => {
      const members: Member[] = [
        createMember('1', createPrefs(1.0, 2500, 120)), // custom
        createMember('2', createPrefs(0.75, null, null)), // defaults: 1500, 38
      ]
      expect(getHouseholdAggregate(members)).toEqual({
        totalCalories: 4000,
        totalProtein: 158,
        memberCount: 2,
        defaultCount: 1,
      })
    })

    it('counts member as using defaults if either value is default', () => {
      const members: Member[] = [
        createMember('1', createPrefs(1.0, 2500, null)), // custom kcal, default protein
      ]
      const result = getHouseholdAggregate(members)
      expect(result.defaultCount).toBe(1)
    })

    it('handles members with null preferences', () => {
      const members: Member[] = [
        createMember('1', null), // defaults: 2000, 50
      ]
      expect(getHouseholdAggregate(members)).toEqual({
        totalCalories: 2000,
        totalProtein: 50,
        memberCount: 1,
        defaultCount: 1,
      })
    })
  })
})
