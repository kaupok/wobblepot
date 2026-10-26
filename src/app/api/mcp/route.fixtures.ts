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
  swap_meal: { date: '2026-10-15', mealType: 'dinner', mealId: 'meal-1' },
  rate_meal: { date: '2026-10-15', mealType: 'dinner', rating: 'up' },
  adjust_meal: { date: '2026-10-15', mealType: 'dinner', instruction: 'No cream' },
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
  add_extra: { date: '2026-10-15', name: 'red wine', quantity: 750, unit: 'ml' },
  remove_extra: { extraId: 'extra-1' },
  clear_meal: { date: '2026-10-15', mealType: 'dinner' },
}
