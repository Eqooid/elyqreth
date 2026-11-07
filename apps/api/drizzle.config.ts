import { defineConfig } from 'drizzle-kit';

// Generation/checking requires no credentials and never connects to a database.
export default defineConfig({
  dialect: 'postgresql', schema: './src/database/schema.ts', out: './migrations',
  strict: true, verbose: false,
});
