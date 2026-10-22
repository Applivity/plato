import { defineConfig } from 'vitest/config';

// `tsc -b` emits the compiled tests into out/; run the source tests only.
export default defineConfig({
  test: { include: ['test/**/*.test.ts'] },
});
