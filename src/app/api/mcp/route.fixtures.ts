/**
 * One valid input per write tool, keyed by tool name, for route.test.ts. The
 * keys are the write tools the server must list; a read-only token must get
 * the reconnect message for each.
 */
export const WRITE_TOOL_ARGS: Record<string, Record<string, unknown>> = {
  mark_purchased: { ingredientIds: ['ing-1'], purchased: true },
  add_shopping_item: { name: 'Dish soap' },
  check_shopping_item: { id: 'custom-1', checked: true },
  set_pantry_status: { ingredientId: 'ing-1', status: 'have_some' },
  set_staple: { name: 'rice', staple: true },
  add_to_pantry: { items: [{ name: 'rice', quantity: 1000, unit: 'g' }] },
  remove_from_pantry: { ingredientId: 'ing-1' },
  swap_meal: { date: '2026-10-15', mealType: 'dinner', mealId: 'meal-1' },
  rate_meal: { date: '2026-10-15', mealType: 'dinner', rating: 'up' },
  adjust_meal: { date: '2026-10-15', mealType: 'dinner', instruction: 'No cream' },
  change_meal_ingredients: {
    date: '2026-10-15',
    mealType: 'dinner',
    changes: [{ action: 'leave_out', ingredient: 'cream' }],
  },
  create_meal: {
    name: 'Lasagne',
    suitableFor: ['dinner'],
    servings: 4,
    ingredients: [{ name: 'beef mince', quantity: 500, unit: 'g' }],
  },
  update_meal: { mealId: 'meal-1', servings: 6 },
  plan_meal: { date: '2026-10-15', mealType: 'dinner', mealId: 'meal-1' },
  plan_fridge_meal: {
    date: '2026-10-15',
    mealType: 'dinner',
    items: [{ label: 'Leftover mash' }],
  },
  fill_plan: { startDate: '2026-10-15', days: 7 },
  add_extra: { date: '2026-10-15', name: 'red wine', quantity: 750, unit: 'ml' },
  remove_extra: { extraId: 'extra-1' },
  clear_meal: { date: '2026-10-15', mealType: 'dinner' },
  set_meal_status: { date: '2026-10-15', mealType: 'dinner', status: 'cooked' },
  set_meal_servings: { date: '2026-10-15', mealType: 'dinner', servings: 6 },
  remove_shopping_item: { id: 'custom-1' },
  set_favourite: { mealId: 'meal-1', favourite: true },
  set_extra_amount: { extraId: 'extra-1', quantity: 1500, unit: 'ml' },
  delete_meal: { mealId: 'meal-1' },
  restore_meal: { mealId: 'meal-1' },
  add_household_note: { note: 'Office days need an easy dinner.' },
  remove_household_note: { note: 'Office days need an easy dinner.' },
}

/**
 * The hints each write tool is listed with, over `readOnlyHint: false`,
 * `destructiveHint: false` and `openWorldHint: false`. A destructive tool is
 * one whose delete the app cannot undo, or whose second call refuses.
 */
export const WRITE_TOOL_ANNOTATIONS: Record<
  string,
  { destructiveHint?: true; idempotentHint: boolean }
> = {
  mark_purchased: { idempotentHint: true },
  check_shopping_item: { idempotentHint: true },
  set_pantry_status: { idempotentHint: true },
  set_staple: { idempotentHint: true },
  add_to_pantry: { idempotentHint: false },
  remove_from_pantry: { idempotentHint: true },
  add_shopping_item: { idempotentHint: false },
  rate_meal: { idempotentHint: true },
  swap_meal: { idempotentHint: false },
  adjust_meal: { idempotentHint: false },
  change_meal_ingredients: { idempotentHint: false },
  create_meal: { idempotentHint: false },
  update_meal: { idempotentHint: true },
  plan_meal: { idempotentHint: false },
  plan_fridge_meal: { idempotentHint: false },
  fill_plan: { idempotentHint: false },
  add_extra: { idempotentHint: false },
  remove_extra: { idempotentHint: false },
  clear_meal: { destructiveHint: true, idempotentHint: false },
  set_meal_status: { idempotentHint: true },
  set_meal_servings: { idempotentHint: true },
  remove_shopping_item: { idempotentHint: false },
  set_favourite: { idempotentHint: true },
  set_extra_amount: { idempotentHint: true },
  delete_meal: { destructiveHint: true, idempotentHint: false },
  restore_meal: { idempotentHint: true },
  add_household_note: { idempotentHint: false },
  remove_household_note: { destructiveHint: true, idempotentHint: false },
}
