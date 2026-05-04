import type { Config } from 'drizzle-kit';

const databaseUrl = process.env['DATABASE_URL'];

export default {
  schema: './src/shared/db/schema/*',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: databaseUrl ?? 'postgres://placeholder:placeholder@localhost:5432/hogaan',
  },
  strict: true,
  verbose: true,
} satisfies Config;
