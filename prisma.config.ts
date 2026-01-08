import 'dotenv/config'
import { defineConfig, env } from 'prisma/config'

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    // Use unpooled URL for CLI operations (migrations, introspection)
    // Pooled URL is used by PrismaClient adapter at runtime
    url: env('DATABASE_URL_UNPOOLED'),
  },
})
