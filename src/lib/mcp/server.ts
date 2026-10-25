import 'server-only'
import { McpServer, type Implementation } from '@modelcontextprotocol/server'
import { runTool, toolAnnotations, type McpCallerContext, type McpTool } from './context'
import { instrumentMcpServer } from './analytics'
import { getMealPlan } from './tools/get-meal-plan'
import { getShoppingList } from './tools/get-shopping-list'
import { getPantry } from './tools/get-pantry'
import { listMeals } from './tools/list-meals'
import { getMeal } from './tools/get-meal'
import { markPurchased } from './tools/mark-purchased'
import { addShoppingItem } from './tools/add-shopping-item'
import { checkShoppingItem } from './tools/check-shopping-item'
import { setPantryStatus } from './tools/set-pantry-status'
import { swapMeal } from './tools/swap-meal'
import { rateMeal } from './tools/rate-meal'
import { adjustMeal } from './tools/adjust-meal'
import { createMeal } from './tools/create-meal'
import { updateMeal } from './tools/update-meal'
import { planMeal } from './tools/plan-meal'
import { addExtra } from './tools/add-extra'
import { removeExtra } from './tools/remove-extra'

/**
 * Every tool the server lists, for every token. The write tools (HON-1154,
 * HON-1173, HON-1174, HON-1246, HON-1305, HON-1306, HON-1311, HON-1314) need
 * `mcp:write`; `runTool` answers a read-only token with the reconnect message,
 * so the model can tell the user what to do.
 */
export const MCP_TOOLS: readonly McpTool[] = [
  getMealPlan,
  getShoppingList,
  getPantry,
  listMeals,
  getMeal,
  markPurchased,
  addShoppingItem,
  checkShoppingItem,
  setPantryStatus,
  swapMeal,
  rateMeal,
  adjustMeal,
  createMeal,
  updateMeal,
  planMeal,
  addExtra,
  removeExtra,
] as McpTool[]

export const MCP_SERVER_DESCRIPTION = "Wobblepot is the household's meal planner."

/**
 * What the server says about itself in `initialize`. Claude shows `icons` in
 * its connector list; without them it falls back to a favicon cache that still
 * held the pre-rebrand icon (HON-1171). The URLs are absolute and built from
 * the deployment's origin, because one build serves staging and production.
 * `name` and `version` stay fixed: `@posthog/mcp` reports them on every event.
 */
export function mcpServerInfo(origin: string): Implementation {
  return {
    name: 'wobblepot',
    title: 'Wobblepot',
    version: '1.0.0',
    description: MCP_SERVER_DESCRIPTION,
    websiteUrl: origin,
    icons: [
      { src: `${origin}/icons/icon-192x192.png`, mimeType: 'image/png', sizes: ['192x192'] },
      { src: `${origin}/icons/icon-512x512.png`, mimeType: 'image/png', sizes: ['512x512'] },
    ],
  }
}

/**
 * One `McpServer` for one request, bound to the caller the route resolved from
 * the access token. A fresh instance per request is the stateless serving
 * model, so no caller's household outlives its request.
 */
export function buildMcpServer(ctx: McpCallerContext, origin: string): McpServer {
  const server = new McpServer(mcpServerInfo(origin), {
    instructions: `${MCP_SERVER_DESCRIPTION} These tools read its meal plan, shopping list, pantry and meals, update its shopping list, pantry and meal plan, and add and change recipes. The update tools work only when the user allowed this assistant to make changes.`,
  })

  for (const tool of MCP_TOOLS) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        outputSchema: tool.outputSchema,
        annotations: toolAnnotations(tool),
      },
      (input) => runTool(tool, ctx, input),
    )
  }

  instrumentMcpServer(server, ctx)
  return server
}
