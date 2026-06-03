export const SUPPORT_EMAIL = 'support@wobblepot.com'
export const SUPPORT_EMAIL_HREF = `mailto:${SUPPORT_EMAIL}` as const

/**
 * Data-subject / privacy contact. Distinct from SUPPORT_EMAIL: this is the
 * address users email to exercise GDPR rights (e.g. cancel a pending account
 * deletion within the 30-day grace window — HON-481) and the DSR intake inbox.
 */
export const PRIVACY_EMAIL = 'privacy@wobblepot.com'
export const PRIVACY_EMAIL_HREF = `mailto:${PRIVACY_EMAIL}` as const

/**
 * Legal entity (data controller). Wobblepot is the user-facing brand; Honkadori
 * OÜ is the registered Estonian company behind it. Per CLAUDE.md, the legal name
 * surfaces only in legal/policy contexts and email legal sign-offs — never as
 * the product name. Source of truth: `compliance/README.md`. These values
 * appear verbatim in the privacy policy (HON-457, GDPR Art. 13(1)(a)).
 */
export const LEGAL_ENTITY_NAME = 'Honkadori OÜ'
export const LEGAL_ENTITY_REGISTRY_CODE = '14197288'
export const LEGAL_ENTITY_ADDRESS = 'Peetri 11, 10415 Tallinn, Estonia'
