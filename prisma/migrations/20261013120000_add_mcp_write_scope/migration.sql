-- HON-1154: the `mcp:write` scope.
--
-- Dynamic and CIMD registration store the server's whole scope list on the
-- client row, and the authorize endpoint refuses any scope outside it. A client
-- registered before `mcp:write` existed would fail with `invalid_scope` once it
-- asks for it, so add it to every client that already has `mcp:read`. The
-- grant itself still needs the user's Allow on /consent.
UPDATE "oauth_client"
SET "scopes" = array_append("scopes", 'mcp:write')
WHERE 'mcp:read' = ANY("scopes")
  AND NOT ('mcp:write' = ANY("scopes"));

-- The MCP resource row narrows every token to its `allowedScopes`. The plugin
-- now re-seeds it on start (`resourceSeedMode: 'merge'` in src/lib/auth.ts);
-- this makes the row right before the first start as well.
UPDATE "oauth_resource"
SET "allowedScopes" = array_append("allowedScopes", 'mcp:write')
WHERE 'mcp:read' = ANY("allowedScopes")
  AND NOT ('mcp:write' = ANY("allowedScopes"));
