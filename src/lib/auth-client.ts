import { createAuthClient } from 'better-auth/react'
import { oauthProviderClient } from '@better-auth/oauth-provider/client'
import { getClientBaseURL } from '@/lib/env'

export const authClient = createAuthClient({
  baseURL: getClientBaseURL(),
  // Inside an OAuth authorization (an MCP client connecting, HON-1150) the
  // sign-in and consent pages carry a signed query. This plugin forwards it as
  // `oauth_query` on their POSTs, so the server can continue the authorization;
  // a page with no signed query sends nothing extra.
  plugins: [oauthProviderClient()],
})
