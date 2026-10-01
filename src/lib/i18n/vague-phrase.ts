import { VAGUE_PHRASES, type VaguePhrase } from '@/lib/vague-quantities'

/**
 * Stored vague phrases ("to taste", "a pinch") are English matcher keys from
 * `VAGUE_PHRASES`, whatever the household's language, so they render through
 * the `enums.VaguePhrase` catalog namespace like any other enum. Article
 * variants ("a pinch" and "pinch") share one key.
 */
export const VAGUE_PHRASE_KEYS = {
  'to taste': 'toTaste',
  'a pinch': 'pinch',
  pinch: 'pinch',
  'a dash': 'dash',
  dash: 'dash',
  'a splash': 'splash',
  splash: 'splash',
  'a drizzle': 'drizzle',
  drizzle: 'drizzle',
  'a handful': 'handful',
  handful: 'handful',
  some: 'some',
  'for garnish': 'forGarnish',
  garnish: 'forGarnish',
  optional: 'optional',
  'as needed': 'asNeeded',
  'a bit': 'bit',
  'a little': 'little',
} as const satisfies Record<VaguePhrase, string>

export type VaguePhraseKey = (typeof VAGUE_PHRASE_KEYS)[VaguePhrase]

/** Translator for the `enums.VaguePhrase` namespace. */
export type VaguePhraseLabel = (key: VaguePhraseKey) => string

function isKnownPhrase(phrase: string): phrase is VaguePhrase {
  return (VAGUE_PHRASES as readonly string[]).includes(phrase)
}

/**
 * The catalog key for a stored phrase, or `null` when the phrase is not in the
 * vocabulary (typed by the user, or an Estonian phrase the model produced).
 */
export function vaguePhraseKey(phrase: string): VaguePhraseKey | null {
  const normalized = phrase.toLowerCase().trim().replace(/\s+/g, ' ')
  return isKnownPhrase(normalized) ? VAGUE_PHRASE_KEYS[normalized] : null
}

/** The phrase in the household's language; unknown phrases pass through unchanged. */
export function formatVaguePhrase(phrase: string, label: VaguePhraseLabel): string {
  const key = vaguePhraseKey(phrase)
  return key ? label(key) : phrase
}

/**
 * Whether two stored phrases read the same once rendered: "a pinch" and
 * "pinch" share a key, so aggregating them keeps the phrase instead of
 * falling back to "some". Phrases outside the vocabulary compare as text.
 */
export function sameVaguePhrase(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const normalize = (phrase: string | null | undefined) =>
    phrase ? (vaguePhraseKey(phrase) ?? phrase.toLowerCase().trim()) : null
  return normalize(a) === normalize(b)
}
