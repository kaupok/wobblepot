import 'server-only'
import { McpServer } from '@modelcontextprotocol/server'
import { READ_ONLY_ANNOTATIONS, runTool, type McpCallerContext, type McpTool } from './context'
import { instrumentMcpServer } from './analytics'
import { getMealPlan } from './tools/get-meal-plan'
import { getShoppingList } from './tools/get-shopping-list'
import { getPantry } from './tools/get-pantry'
import { listMeals } from './tools/list-meals'
import { getMeal } from './tools/get-meal'

/** Every tool the server lists. All of them only read. */
export const MCP_TOOLS: readonly McpTool[] = [
  getMealPlan,
  getShoppingList,
  getPantry,
  listMeals,
  getMeal,
] as McpTool[]

export const MCP_SERVER_INFO = { name: 'wobblepot', title: 'Wobblepot', version: '1.0.0' }

/**
 * One `McpServer` for one request, bound to the caller the route resolved from
 * the access token. A fresh instance per request is the stateless serving
 * model, so no caller's household outlives its request.
 */
export function buildMcpServer(ctx: McpCallerContext): McpServer {
  const server = new McpServer(MCP_SERVER_INFO, {
    instructions:
      "Wobblepot is the household's meal planner. These tools read its meal plan, shopping list, pantry and meals. They cannot change anything.",
  })

  for (const tool of MCP_TOOLS) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        outputSchema: tool.outputSchema,
        annotations: READ_ONLY_ANNOTATIONS,
      },
      (input) => runTool(tool, ctx, input),
    )
  }

  instrumentMcpServer(server, ctx)
  return server
}
