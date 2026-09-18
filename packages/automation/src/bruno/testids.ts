import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { appBundleOf } from '../discovery.js';

/**
 * Phase 9: the `data-testid` vocabulary of the detected Bruno build, scanned from `app.asar` the way
 * `docs/bruno-automation-surface.md` measures it (`"data-testid":"…"` literals in the bundled
 * renderer). ~250 MB streamed once per executable, then cached. Falls back to the 4.1.0 list shipped
 * with this package when the archive cannot be read.
 */
const PATTERN = /"data-testid":"([a-zA-Z0-9_-]{2,80})"/g;
const cache = new Map<string, { mtimeMs: number; ids: string[] }>();

export async function fallbackTestIds(): Promise<{ brunoVersion: string; testIds: string[] }> {
  const file = fileURLToPath(new URL('./testids-4.1.0.json', import.meta.url));
  return JSON.parse(await readFile(file, 'utf8')) as { brunoVersion: string; testIds: string[] };
}

export async function extractTestIds(executablePath: string): Promise<{ testIds: string[]; source: 'asar' | 'fallback' }> {
  const app = appBundleOf(executablePath);
  const asar = app ? path.join(app, 'Contents', 'Resources', 'app.asar') : undefined;
  if (!asar) return { testIds: (await fallbackTestIds()).testIds, source: 'fallback' };
  let info;
  try { info = await stat(asar); } catch { return { testIds: (await fallbackTestIds()).testIds, source: 'fallback' }; }
  const hit = cache.get(asar);
  if (hit && hit.mtimeMs === info.mtimeMs) return { testIds: hit.ids, source: 'asar' };
  const found = new Set<string>();
  let tail = '';
  await new Promise<void>((resolve, reject) => {
    const rs = createReadStream(asar, { highWaterMark: 4 * 1024 * 1024, encoding: 'latin1' });
    rs.on('data', (chunk) => {
      const text = tail + (chunk as string);
      for (const m of text.matchAll(PATTERN)) found.add(m[1]!);
      tail = text.slice(-120);
    });
    rs.on('end', resolve);
    rs.on('error', reject);
  }).catch(() => undefined);
  if (found.size < 50) return { testIds: (await fallbackTestIds()).testIds, source: 'fallback' };
  const ids = [...found].sort();
  cache.set(asar, { mtimeMs: info.mtimeMs, ids });
  return { testIds: ids, source: 'asar' };
}
