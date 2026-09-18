#!/usr/bin/env node
// Dev-time launcher: run the TypeScript CLI through tsx. A bundled build replaces this at release.
const { register } = await import('tsx/esm/api');
register();
const { main } = await import(new URL('../src/main.ts', import.meta.url).href);
const code = await main().catch((err) => { console.error(err instanceof Error ? err.message : err); return 1; });
process.exit(code);
