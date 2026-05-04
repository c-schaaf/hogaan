import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    exclude: ['node_modules', 'dist', 'drizzle'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      exclude: ['drizzle/**', 'dist/**', 'tests/**', 'drizzle.config.ts', 'vitest.config.ts'],
    },
  },
});
