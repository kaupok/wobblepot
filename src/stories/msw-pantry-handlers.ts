import { http, type HttpHandler, HttpResponse } from 'msw'

import type { IngredientResult } from '@/components/household/meal-form-types'
import type { PantryItemData } from '@/components/pantry/PantryItem'

import { ingredientResults } from './fixtures'

/**
 * The pantry routes' mock answers, split out of `msw-handlers.ts` by
 * responsibility. `defaultHandlers` spreads `pantryHandlers`; the error and
 * conflict sets are re-exported from there.
 */
export const pantryHandlers: HttpHandler[] = [
  // Pantry CRUD — used by `InlineAddItem` (POST) and `PantryItem` (PATCH for
  // toggle-staple, DELETE for remove).
  http.post('/api/pantry', async ({ request }) => {
    const body = (await request.json().catch(() => ({}))) as {
      ingredientId?: string
      isStaple?: boolean
    }
    const ingredientId = body.ingredientId ?? 'new-ingredient'
    const catalogEntry: IngredientResult | undefined = (
      ingredientResults as Record<string, IngredientResult>
    )[ingredientId]
    const ingredient: PantryItemData['ingredient'] = catalogEntry
      ? {
          id: catalogEntry.id,
          name: catalogEntry.name,
          category: catalogEntry.category,
          defaultUnit: catalogEntry.defaultUnit,
        }
      : {
          id: ingredientId,
          name: ingredientId,
          category: 'condiment',
          defaultUnit: 'g',
        }
    const item: PantryItemData = {
      id: `pantry-${ingredientId}-${Date.now()}`,
      ingredient,
      quantity: null,
      isStaple: body.isStaple ?? false,
      updatedAt: new Date().toISOString(),
    }
    return HttpResponse.json(item)
  }),
  http.patch('/api/pantry/:id', () => HttpResponse.json({ ok: true })),
  http.delete('/api/pantry/:id', () => HttpResponse.json({ ok: true })),
  // The staples the shopping list's "Add item" dropdown suggests (HON-1400).
  http.get('/api/pantry/staples', () =>
    HttpResponse.json({
      staples: [
        { id: 'pantry-milk', name: 'Milk', englishName: 'Milk', quantity: null },
        { id: 'pantry-olive-oil', name: 'Olive oil', englishName: 'Olive oil', quantity: null },
      ],
    }),
  ),
]

/**
 * Return 500 errors for pantry CRUD endpoints. Use for stories that exercise
 * the rollback / error-toast path on add / toggle-staple / remove.
 */
export const errorPantryHandlers: HttpHandler[] = [
  http.post('/api/pantry', () =>
    HttpResponse.json({ error: 'Failed to add item' }, { status: 500 }),
  ),
  http.patch('/api/pantry/:id', () =>
    HttpResponse.json({ error: 'Failed to update item' }, { status: 500 }),
  ),
  http.delete('/api/pantry/:id', () =>
    HttpResponse.json({ error: 'Failed to remove item' }, { status: 500 }),
  ),
]

/**
 * Return a 409 conflict for `POST /api/pantry`. The component surfaces this as
 * an "already in your pantry" toast without firing `onItemAdded`.
 */
export const conflictPantryHandlers: HttpHandler[] = [
  http.post('/api/pantry', () =>
    HttpResponse.json({ error: 'Already in pantry' }, { status: 409 }),
  ),
]
