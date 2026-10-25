/**
 * The units an MCP write tool takes an amount in (`create_meal`, `add_extra`):
 * the ones an ingredient's `defaultUnit` converts from without a guess.
 */
export const MEASURED_UNITS = ['g', 'ml', 'piece'] as const
export type MeasuredUnit = (typeof MEASURED_UNITS)[number]

export function isMeasured(unit: string): unit is MeasuredUnit {
  return (MEASURED_UNITS as readonly string[]).includes(unit)
}
