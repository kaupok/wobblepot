import 'server-only'
import { defineTool } from '@/lib/mcp/context'
import { mealPlanInputSchema, mealPlanOutputSchema, readMealPlan } from '@/lib/api/v1/meal-plan'

/** The read is shared with `GET /api/v1/meal-plan` (HON-1220). */
export const getMealPlan = defineTool({
  name: 'get_meal_plan',
  title: 'Get meal plan',
  description:
    "Returns the meals planned for the household by date and meal type. Use it to answer what is for dinner, what is planned this week, or whether a day has a meal yet. Defaults to today and the next 6 days in the household's timezone.",
  inputSchema: mealPlanInputSchema,
  outputSchema: mealPlanOutputSchema,
  run: readMealPlan,
})
