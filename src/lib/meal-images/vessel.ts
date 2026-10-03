import { z } from 'zod'

/**
 * The vessel a meal illustration serves its food in (HON-1024). Classified
 * once per image by a vision call, so `footprint.ts` can scale every plate to
 * one width and every bowl to another: the prompt's "about half the width of
 * the frame" came out anywhere from 0.50 to 0.68 for a plate. A wide shallow
 * bowl is told from a small deep one in `footprint.ts`, by geometry, not
 * here: asked for the two classes, the model put the same yogurt bowl in
 * either from one call to the next.
 *
 * Deliberately free of `server-only`, like `judge.ts`: the model call lives
 * in `generate.ts`, and the backfill script shares the prompt and the schema.
 */

export const VESSELS = ['plate', 'bowl', 'glass', 'board', 'other'] as const

export type Vessel = (typeof VESSELS)[number]

export const vesselSchema = z.object({
  vessel: z.enum(VESSELS).describe('The single vessel the food is served in'),
  reason: z.string().describe('One short sentence on what makes it that vessel'),
})

export type VesselFindings = z.infer<typeof vesselSchema>

/** `undefined` or an unknown value (a mocked model, a changed schema) reads as "not classified". */
export function asVessel(value: unknown): Vessel | null {
  return typeof value === 'string' && (VESSELS as readonly string[]).includes(value)
    ? (value as Vessel)
    : null
}

/**
 * The classification prompt. A pasta plate is a plate: what matters for the
 * footprint is the wide rim that sets the width, not how much it holds.
 */
export const VESSEL_PROMPT = `Which single vessel holds the food in this illustration?
- plate: a flat or shallow dish with a wide rim (dinner plate, pasta plate, saucer), even when it holds a saucy dish.
- bowl: a deep dish with high sides (cereal bowl, soup bowl, ramen bowl).
- glass: a glass, jar, cup or mug.
- board: a board, slate, basket, tray or paper.
- other: anything else, including a pan, skillet or baking dish.
Answer with the vessel and one short reason.`
