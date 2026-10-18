import { createEnv } from '@causedeck/config/env';
import { defineConfig } from 'drizzle-kit';

// drizzle-kit talks to the database (migrate, studio, push) as the schema owner.
const ownerUrl = createEnv().DATABASE_URL_OWNER;
if (ownerUrl === undefined) {
  throw new Error('DATABASE_URL_OWNER is not set: drizzle-kit runs as the schema owner role.');
}

export default defineConfig({
  schema: './src/schema/index.ts',
  out: './migrations',
  dialect: 'postgresql',
  casing: 'snake_case',
  dbCredentials: { url: ownerUrl.reveal() },
  strict: true,
  verbose: true,
});
