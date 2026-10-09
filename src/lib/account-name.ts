/**
 * The account name (`User.name`) limit, shared by the profile name form and
 * the `/update-user` guard in `src/lib/auth.ts` (HON-1129). Pure, so the
 * client form can import it without pulling in the auth server.
 */
export const MAX_ACCOUNT_NAME_LENGTH = 100
