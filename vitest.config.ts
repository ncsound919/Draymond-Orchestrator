import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(process.cwd(), 'src'),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Many fleet tests spawn subprocesses (python, git, npm) which are slow
    // under full-suite CPU contention. Give every test a generous default so
    // none silently trips the 5s vitest baseline; long-running suites override
    // per-test as needed.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/lib/draymond/**/*.ts', 'src/lib/mathx/**/*.ts'],
      exclude: [
        'src/lib/draymond/index.ts',
        'src/lib/draymond/types.ts',
        'src/lib/draymond/api-auth.ts',
        'src/lib/draymond/seed.ts',
        'src/lib/draymond/business-chains.ts',
        'src/lib/draymond/chains-seed.ts',
        'src/lib/mathx/types.ts',
        'src/lib/mathx/index.ts',
        'src/lib/mathx/route-helpers.ts',
      ],
      thresholds: {
        // Floors set to the current measured coverage of the orchestration core
        // (lines 69.5 / stmts 67.9 / funcs 68.9 / branches 55.6) with a small
        // margin, so CI is green and the README badge reflects reality. Raise
        // these deliberately as new tests land.
        lines: 69,
        statements: 67,
        functions: 68,
        branches: 55,
      },
    },
  },
});
