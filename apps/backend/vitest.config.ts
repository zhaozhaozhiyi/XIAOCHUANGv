import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: [
        'src/modules/auth/auth.controller.ts',
        'src/modules/auth/auth-dev.ts',
        'src/modules/auth/password.ts',
        'src/modules/auth/roles.guard.ts',
        'src/modules/auth/session-auth.guard.ts',
      ],
      exclude: ['src/**/*.test.ts'],
      thresholds: {
        statements: 80,
        branches: 72,
        functions: 80,
        lines: 80,
      },
    },
  },
})
