import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts', 'apps/server/test/**/*.test.ts'],
    environment: 'node',
    // Hermetic: tests must never see the user's real API keys (Keychain or env).
    env: { BRU_CAPTURE_KEYCHAIN_SERVICE: 'com.usebruno.capture.test', ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '' },
  },
});
