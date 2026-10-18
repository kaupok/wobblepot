import 'server-only'
import { prisma } from '@/lib/prisma'

/**
 * The read behind `GET /api/auth/user/export` (GDPR Art. 20 / UK-GDPR right
 * to portability, HON-1216): the user's personal data, which the route wraps
 * in a versioned envelope and returns as a JSON attachment. The route owns the
 * session and the rate limit; this module is tested against a database in
 * `export.db.test.ts`.
 *
 * Scoping:
 *  - Always: user profile, own session metadata (without tokens), own
 *    HouseholdMember + MemberPreferences rows across every membership,
 *    and the apps connected through OAuth (HON-1150): each consent's app
 *    name, scopes and dates, never a token.
 *  - Per owner-household: full tree (members, prefs, meals, plans,
 *    pantry, favorites, custom shopping items, invites, AI usage).
 *  - Per non-owner-membership household: shared context only. Other
 *    members' names, preferences, and the user link are redacted;
 *    invites and AI usage are not exposed.
 *
 * Ingredients (HON-880), in every household: the household's own
 * ingredients in full, with translations, under `ingredients`. Global
 * ingredients referenced by an exported meal component, entry ingredient
 * change, pantry item, custom shopping item or preference exclusion list go under `referencedGlobalIngredients` with only
 * `id`, `name` and `defaultUnit`, so the `ingredientId`s in the file
 * resolve. Their nutrition and allergen columns are Wobblepot's catalogue,
 * not the user's data, and stay out. A reference to another household's
 * ingredient is deliberately left unresolved: exporting it would leak that
 * household's row. The `householdId: null` filter below is what enforces it.
 *
 * Never exposed: password hashes, session tokens, Better Auth internals.
 *
 * Soft-deleted meals (deletedAt != null) are intentionally included: under
 * GDPR, all retained personal data is the user's data. Do not add a
 * `deletedAt: null` filter here by analogy with the app-facing routes.
 */

// A year of meal planning + AI usage can involve thousands of rows across
// AiUsage, MealPlanEntry, and MealComponent, all serialised through the
// interactive-tx connection. Default 5s is too tight; a failed export still
// spends one of the 3/day rate-limit slots, so we degrade gracefully.
const EXPORT_TRANSACTION_TIMEOUT_MS = 30_000

/** Every row the export holds for `userId`, before the route's envelope. */
export async function exportUserData(userId: string) {
  return prisma.$transaction(
    async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          name: true,
          email: true,
          emailVerified: true,
          image: true,
          createdAt: true,
          updatedAt: true,
          acceptedTermsAt: true,
          acceptedTermsVersion: true,
        },
      })

      if (!user) {
        throw new Error('User not found')
      }

      // Session metadata only — never include token.
      const sessions = await tx.session.findMany({
        where: { userId },
        select: {
          id: true,
          createdAt: true,
          updatedAt: true,
          expiresAt: true,
          ipAddress: true,
          userAgent: true,
        },
        orderBy: { createdAt: 'asc' },
      })

      // Apps such as Claude that the user allowed on `/consent` (HON-1150).
      // The consent row and the client's self-declared name only; the
      // tokens stay out, like the session tokens above.
      const connectedApps = (
        await tx.oauthConsent.findMany({
          where: { userId },
          select: {
            scopes: true,
            createdAt: true,
            updatedAt: true,
            client: { select: { name: true } },
          },
          orderBy: { createdAt: 'asc' },
        })
      ).map(({ client, ...consent }) => ({ appName: client.name, ...consent }))

      const memberships = await tx.householdMember.findMany({
        where: { userId },
        select: { householdId: true, role: true },
      })

      const households = await Promise.all(
        memberships.map(async ({ householdId, role }) => {
          const isOwner = role === 'owner'

          const household = await tx.household.findUnique({
            where: { id: householdId },
            include: { preferences: true },
          })

          // Unreachable in practice (FK guarantees the household exists), but
          // keeps the types honest if a household is deleted mid-export.
          if (!household) return null

          const allMembers = await tx.householdMember.findMany({
            where: { householdId },
            include: { preferences: true },
            orderBy: { joinedAt: 'asc' },
          })

          const members = allMembers.map((member) => {
            // Own row is always fully included. In an owner-household, all
            // rows are fully included.
            if (isOwner || member.userId === userId) {
              return {
                id: member.id,
                userId: member.userId,
                name: member.name,
                role: member.role,
                joinedAt: member.joinedAt,
                preferences: member.preferences,
                // The weekly reminder is the member's own consent (HON-1084),
                // so only the caller's row carries it. Never the stop token,
                // which switches the reminder off, nor the confirm token,
                // which confirms the address (HON-1113).
                ...(member.userId === userId && {
                  reminderWeekday: member.reminderWeekday,
                  reminderConsentAt: member.reminderConsentAt,
                  reminderConfirmedAt: member.reminderConfirmedAt,
                  reminderLastSentAt: member.reminderLastSentAt,
                }),
              }
            }
            // Non-owner household, other member: redact name, preferences,
            // and the user link (which could re-identify the person). Keep
            // id/role/joinedAt for referential integrity.
            return {
              id: member.id,
              role: member.role,
              joinedAt: member.joinedAt,
            }
          })

          const [meals, mealPlans, pantryItems, favoriteMeals, customShoppingItems, ingredients] =
            await Promise.all([
              tx.meal.findMany({
                where: { householdId },
                include: { components: true },
                orderBy: { createdAt: 'asc' },
              }),
              tx.mealPlan.findMany({
                where: { householdId },
                // Each entry's own ingredient changes (HON-1243).
                include: { entries: { include: { changes: true } } },
                orderBy: { createdAt: 'asc' },
              }),
              tx.pantryItem.findMany({
                where: { householdId },
                orderBy: { updatedAt: 'asc' },
              }),
              tx.favoriteMeal.findMany({
                where: { householdId },
                orderBy: { createdAt: 'asc' },
              }),
              tx.customShoppingItem.findMany({
                where: { householdId },
                orderBy: { createdAt: 'asc' },
              }),
              tx.ingredient.findMany({
                where: { householdId },
                include: { translations: { orderBy: { locale: 'asc' } } },
                orderBy: { name: 'asc' },
              }),
            ])

          // Ids the exported rows point at that this household does not own:
          // the global ingredients needed to make those references readable.
          const ownIngredientIds = new Set(ingredients.map((i) => i.id))
          const referencedIds = new Set<string>()
          for (const meal of meals) {
            for (const component of meal.components) referencedIds.add(component.ingredientId)
          }
          for (const item of pantryItems) referencedIds.add(item.ingredientId)
          for (const plan of mealPlans) {
            for (const entry of plan.entries) {
              for (const change of entry.changes) {
                if (change.originalIngredientId) referencedIds.add(change.originalIngredientId)
                if (change.replacementIngredientId) {
                  referencedIds.add(change.replacementIngredientId)
                }
              }
            }
          }
          for (const item of customShoppingItems) {
            if (item.ingredientId) referencedIds.add(item.ingredientId)
          }
          // Exclusion lists, read from the exported (possibly redacted) member
          // rows so a redacted member's exclusions cannot surface here.
          const exclusionLists = [
            household.preferences?.excludedIngredientIds ?? [],
            ...members.map(
              (m) => ('preferences' in m && m.preferences?.excludedIngredientIds) || [],
            ),
          ]
          for (const ids of exclusionLists) for (const id of ids) referencedIds.add(id)
          const globalIds = [...referencedIds].filter((id) => !ownIngredientIds.has(id))

          const referencedGlobalIngredients =
            globalIds.length === 0
              ? []
              : await tx.ingredient.findMany({
                  where: { id: { in: globalIds }, householdId: null },
                  select: { id: true, name: true, defaultUnit: true },
                  orderBy: { name: 'asc' },
                })

          const base = {
            role,
            household,
            members,
            meals,
            mealPlans,
            pantryItems,
            favoriteMeals,
            customShoppingItems,
            ingredients,
            referencedGlobalIngredients,
          }

          if (!isOwner) {
            // Non-owner members cannot see invites or AI usage.
            return base
          }

          const [invites, aiUsage] = await Promise.all([
            tx.householdInvite.findMany({
              where: { householdId },
              orderBy: { createdAt: 'asc' },
            }),
            tx.aiUsage.findMany({
              where: { householdId },
              orderBy: { createdAt: 'asc' },
            }),
          ])

          return { ...base, invites, aiUsage }
        }),
      )

      // Consent fields (HON-457) come straight from the `select` above:
      // `acceptedTermsAt: Date | null`, `acceptedTermsVersion: number | null`.
      // Pre-policy users export as nulls.
      return {
        user: {
          ...user,
          sessions,
          connectedApps,
        },
        households: households.filter((h): h is NonNullable<typeof h> => h !== null),
      }
    },
    { timeout: EXPORT_TRANSACTION_TIMEOUT_MS },
  )
}

export type UserDataExport = Awaited<ReturnType<typeof exportUserData>>
