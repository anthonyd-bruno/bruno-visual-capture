import { execFile } from 'node:child_process';
import type { AddressInfo } from 'node:net';
import { buildApp } from './app.js';
import { createContext, type ServerContext } from './context.js';

export interface StartServerOptions {
  /** 0 → pick a free port (PRD §6). */
  port?: number;
  openBrowser?: boolean;
  logger?: boolean;
  /** Override the Application Support root (tests). */
  root?: string;
  log?: (message: string) => void;
}

export interface RunningServer {
  url: string;
  port: number;
  ctx: ServerContext;
  close(): Promise<void>;
}

export async function startServer(opts: StartServerOptions = {}): Promise<RunningServer> {
  const ctx = await createContext({ root: opts.root, log: opts.log });
  const app = await buildApp(ctx, { logger: opts.logger });
  await app.listen({ host: '127.0.0.1', port: opts.port ?? 0 });
  const { port } = app.server.address() as AddressInfo;
  app.setBoundPort(port);
  const url = `http://127.0.0.1:${port}`;
  if (opts.openBrowser) execFile('/usr/bin/open', [url], () => undefined);
  return { url, port, ctx, close: () => app.close() };
}

// `tsx src/main.ts` — dev entry
if (process.argv[1] && /apps\/server\/src\/main\.ts$/.test(process.argv[1])) {
  const server = await startServer({ port: Number(process.env.PORT ?? 0), openBrowser: process.env.OPEN === '1', logger: process.env.LOG === '1', log: (m) => console.log('  ·', m) });
  console.log(`Bruno Capture backend listening on ${server.url}`);
  const stop = () => { void server.close().then(() => process.exit(0)); };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
}
