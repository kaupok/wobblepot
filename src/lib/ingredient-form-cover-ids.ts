import { INGREDIENT_FORM_COVERS } from '@/lib/ingredient-form-covers'
import { prisma } from '@/lib/prisma'

/**
 * The herb cover table as ids of the global catalogue: form row id → bare row
 * id (HON-1558). A household row of the same name is not a cover.
 */
export async function loadFormCoverIds(): Promise<Map<string, string>> {
  const names = [
    ...new Set([...Object.keys(INGREDIENT_FORM_COVERS), ...Object.values(INGREDIENT_FORM_COVERS)]),
  ]
  const rows = await prisma.ingredient.findMany({
    where: { householdId: null, name: { in: names } },
    select: { id: true, name: true },
  })
  const idByName = new Map(rows.map((r) => [r.name, r.id]))

  const covers = new Map<string, string>()
  for (const [form, bare] of Object.entries(INGREDIENT_FORM_COVERS)) {
    const formId = idByName.get(form)
    const bareId = idByName.get(bare)
    if (formId && bareId) covers.set(formId, bareId)
  }
  return covers
}
