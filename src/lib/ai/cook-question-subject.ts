// Its own module, free of the prompt code, so the cook view's client bundle
// can import it (as `cook-question-limits.ts` is).

/**
 * What a cook question is about: one step, or one item in "You'll need"
 * (HON-983). The index points into the steps or the equipment the request
 * carries.
 */
export type CookQuestionSubject =
  { kind: 'step'; index: number } | { kind: 'equipment'; index: number }

export function sameSubject(
  a: CookQuestionSubject | null | undefined,
  b: CookQuestionSubject | null | undefined,
): boolean {
  return !!a && !!b && a.kind === b.kind && a.index === b.index
}
