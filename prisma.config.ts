import 'dotenv/config'
import { defineConfig } from 'prisma/config'

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    // Use unpooled URL for CLI operations (migrations, introspection)
    // Pooled URL is used by PrismaClient adapter at runtime
    // Use process.env to allow prisma generate to work without database URL in CI
    url: process.env.DATABASE_URL_UNPOOLED,
  },
})
