/**
 * Wobblepot-Bot's public identity. Kept dependency-free so the static /bot page
 * can import it without pulling `robots.ts`'s Redis client into its module graph.
 */
export const WOBBLEPOT_BOT_USER_AGENT = 'Wobblepot-Bot/1.0 (+https://wobblepot.com/bot)'

/**
 * The token portion of the UA, used for robots.txt matching.
 * robots.txt rules match against the token (before the space and paren comment),
 * not the full parenthesised UA string.
 */
export const WOBBLEPOT_BOT_TOKEN = 'Wobblepot-Bot/1.0'
