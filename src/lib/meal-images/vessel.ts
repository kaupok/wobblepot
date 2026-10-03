import { z } from 'zod'

/**
 * The vessel a meal illustration serves its food in, and its real size
 * (HON-1024). Classified once per image by a vision call, so `footprint.ts`
 * can draw every vessel to one scale: the prompt's "about half the width of
 * the frame" came out anywhere from 0.50 to 0.68 for a plate, and the side
 * plate under a bagel was drawn as wide as the dinner plate under a
 * shakshuka. Pixels cannot tell a 20 cm plate from a 27 cm one; the food
 * can, because a bagel is 10 cm. Asked for the diameter, the model agreed
 * with itself within 2 cm on every one of 51 images, exactly on 44.
 *
 * Deliberately free of `server-only`, like `judge.ts`: the model call lives
 * in `generate.ts`, and the backfill script shares the prompt and the schema.
 */

export const VESSELS = ['plate', 'bowl', 'glass', 'board', 'other'] as const

export type Vessel = (typeof VESSELS)[number]

export const vesselSchema = z.object({
  vessel: z.enum(VESSELS).describe('The single vessel the food is served in'),
  diameterCm: z
    .number()
    .int()
    .describe("The rim's diameter in centimetres, judged from the real size of the food on it"),
  reason: z.string().describe('One short sentence on what makes it that vessel and that size'),
})

export type VesselFindings = z.infer<typeof vesselSchema>

/** What the fit needs from the model: which vessel, and how wide it is in life. */
export interface VesselEstimate {
  vessel: Vessel
  diameterCm: number
}

/** Dishware comes in this range; an estimate outside it is a misread and leaves the image as drawn. */
export const DIAMETER_CM_RANGE = { min: 10, max: 40 } as const

/** `undefined` or an unknown value (a mocked model, a changed schema) reads as "not classified". */
export function asVessel(value: unknown): Vessel | null {
  return typeof value === 'string' && (VESSELS as readonly string[]).includes(value)
    ? (value as Vessel)
    : null
}

/** The estimate in a model answer, or null when either part is missing or outside dishware sizes. */
export function asVesselEstimate(value: unknown): VesselEstimate | null {
  if (typeof value !== 'object' || value === null) return null
  const { vessel, diameterCm } = value as Record<string, unknown>
  const known = asVessel(vessel)
  if (!known || typeof diameterCm !== 'number' || !Number.isFinite(diameterCm)) return null
  const cm = Math.round(diameterCm)
  if (cm < DIAMETER_CM_RANGE.min || cm > DIAMETER_CM_RANGE.max) return null
  return { vessel: known, diameterCm: cm }
}

/**
 * The classification prompt. A pasta plate is a plate: what matters for the
 * footprint is the rim that sets the width, not how much it holds. The size
 * anchors are what made two runs agree: without them the model has nothing
 * to measure a plate against but itself.
 */
export const VESSEL_PROMPT = `Which single vessel holds the food in this illustration, and how wide is it?
- plate: a flat or shallow dish with a wide rim (dinner plate, pasta plate, saucer), even when it holds a saucy dish.
- bowl: a deep dish with high sides (cereal bowl, soup bowl, ramen bowl).
- glass: a glass, jar, cup or mug.
- board: a board, slate, basket, tray or paper.
- other: anything else, including a pan, skillet or baking dish.
Estimate the rim's diameter in centimetres from the real size of the food on it: a bagel or a slice of toast is about 10 cm across, an egg 6 cm, a croissant 12 cm long, a chicken thigh 10 cm. For reference, a dinner plate is 26–28 cm, a side plate 18–21 cm, a pasta bowl 22–24 cm, a cereal bowl 14–16 cm. Answer with the vessel, the diameter and one short reason.`
