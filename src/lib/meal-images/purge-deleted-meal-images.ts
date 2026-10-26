import 'server-only'
import { prisma } from '@/lib/prisma'
import { restoreWindowStart } from '@/lib/deleted-household-meals'
import { captureApiError } from '@/lib/errors'
import { clearMealImage } from '@/lib/meal-images/invalidation'

/**
 * Clears the image of every recipe deleted before the restore window
 * (HON-1336), run daily by `/api/cron/purge-deleted-users`. A delete keeps the
 * image so a restore brings it back; once the recipe can no longer be
 * restored, the image serves no purpose. The `Meal` row stays, because past
 * plan entries and the MCP `get_meal` still read it.
 *
 * Each image is cleared in its own transaction. Returns the URLs it cleared,
 * which the caller deletes once this has committed, as `clearMealImage`
 * requires. A failed clear is reported and skipped, as the cron's user purge
 * does: the URLs already cleared are gone from the database, so losing them
 * here would leave their files in storage for good. The next run retries it.
 */
export async function purgeExpiredDeletedMealImages(now: Date = new Date()): Promise<string[]> {
  const expired = await prisma.meal.findMany({
    where: { deletedAt: { lt: restoreWindowStart(now) }, imageUrl: { not: null } },
    select: { id: true },
    orderBy: { id: 'asc' },
  })

  const urls: string[] = []
  for (const { id } of expired) {
    try {
      const url = await prisma.$transaction((tx) => clearMealImage(tx, id))
      if (url) urls.push(url)
    } catch (error) {
      captureApiError(error, {
        route: '/api/cron/purge-deleted-users',
        operation: 'meal-image-purge',
      })
    }
  }

  return urls
}
