import { dehydrate, HydrationBoundary } from '@tanstack/react-query'
import { getQueryClient } from '@/lib/get-query-client'
import { listHouseholdIngredients } from '@/lib/ingredients/manage'
import { HouseholdIngredientList } from '@/components/household/HouseholdIngredientList'
import {
  HOUSEHOLD_INGREDIENTS_QUERY_KEY,
  type HouseholdIngredientsResponse,
} from '@/components/household/household-ingredients-query'
import { householdTabMetadata, requireHouseholdMember } from '../household-member'

export function generateMetadata() {
  return householdTabMetadata('ingredients')
}

/**
 * Household → Ingredients (HON-1264): the ingredients the household added
 * from a recipe, with Edit and Delete. Open to every member, as adding one is.
 */
export default async function HouseholdIngredientsPage() {
  const { membership } = await requireHouseholdMember()

  // Prefetched so the list is in the first HTML response, as the Members tab
  // does. A failed prefetch is not dehydrated, so the list fetches it itself.
  const queryClient = getQueryClient()
  await queryClient.prefetchQuery({
    queryKey: HOUSEHOLD_INGREDIENTS_QUERY_KEY,
    retry: false,
    queryFn: async (): Promise<HouseholdIngredientsResponse> => ({
      ingredients: await listHouseholdIngredients(membership.householdId),
    }),
  })

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <HouseholdIngredientList />
    </HydrationBoundary>
  )
}
