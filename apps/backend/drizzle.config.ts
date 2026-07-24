import { defineConfig } from 'drizzle-kit'

function getRequiredEnv(name: string) {
  const value = process.env[name]?.trim()
  if (value) return value
  throw new Error(`${name} is required for drizzle-kit commands`)
}

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  dbCredentials: {
    url: getRequiredEnv('DATABASE_URL'),
  },
})
