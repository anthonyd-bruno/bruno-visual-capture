import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { FixtureSummary } from '@bruno-capture/shared';
import { findCollection } from './fixtures.js';

async function walk(dir: string, rel = '', depth = 0): Promise<string[]> {
  if (depth > 3) return [];
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    if (e.name.startsWith('.')) continue;
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...(await walk(path.join(dir, e.name), r, depth + 1)));
    else out.push(r);
  }
  return out;
}

async function describeCollection(colDir: string): Promise<FixtureSummary['collection']> {
  const col = await findCollection(colDir);
  if (!col) return undefined;
  const requests: Array<{ name: string; method: string; url: string }> = [];
  for (const f of await readdir(col.path).catch(() => [])) {
    if (!/\.ya?ml$/i.test(f) || f === 'opencollection.yml') continue;
    try {
      const doc = parseYaml(await readFile(path.join(col.path, f), 'utf8')) as { info?: { name?: string; type?: string }; http?: { method?: string; url?: string } } | null;
      if (doc?.info?.name && doc.http) requests.push({ name: doc.info.name, method: String(doc.http.method ?? 'GET').toUpperCase(), url: String(doc.http.url ?? '') });
    } catch { /* not a request */ }
  }
  const environments: Array<{ name: string; variables: string[] }> = [];
  for (const f of await readdir(path.join(col.path, 'environments')).catch(() => [])) {
    if (!/\.ya?ml$/i.test(f)) continue;
    try {
      const doc = parseYaml(await readFile(path.join(col.path, 'environments', f), 'utf8')) as { name?: string; variables?: Array<{ name?: string }> } | null;
      environments.push({ name: doc?.name ?? f.replace(/\.ya?ml$/i, ''), variables: (doc?.variables ?? []).map((v) => String(v.name ?? '')).filter(Boolean) });
    } catch { /* skip */ }
  }
  return { name: col.name, requests, environments };
}

/** Phase 9: everything under `fixtures/<feature>/<name>` that contains a collection, described for the planner. */
export async function describeBundledFixtures(fixturesDir: string): Promise<FixtureSummary[]> {
  const out: FixtureSummary[] = [];
  for (const feature of await readdir(fixturesDir, { withFileTypes: true }).catch(() => [])) {
    if (!feature.isDirectory() || feature.name.startsWith('.')) continue;
    for (const fx of await readdir(path.join(fixturesDir, feature.name), { withFileTypes: true }).catch(() => [])) {
      if (!fx.isDirectory()) continue;
      const dir = path.join(fixturesDir, feature.name, fx.name);
      const collection = await describeCollection(dir);
      if (!collection) continue;
      let description = '';
      try { description = (await readFile(path.join(dir, 'README.md'), 'utf8')).split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))[0] ?? ''; } catch { /* none */ }
      const files = (await walk(dir)).filter((f) => !f.startsWith('collection/') && f !== 'README.md');
      const isFile = await stat(dir).then((s) => s.isDirectory()).catch(() => false);
      if (isFile) out.push({ path: `${feature.name}/${fx.name}`, description, collection, files });
    }
  }
  return out.sort((a, b) => a.path.localeCompare(b.path));
}
