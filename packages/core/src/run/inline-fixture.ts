import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { stringify as toYaml } from 'yaml';
import type { InlineCollection, InlineRequest } from '@bruno-capture/shared';

/**
 * Phase 9: write an inline collection as Bruno 4.1 opencollection YAML — the exact shapes Bruno
 * itself wrote in S10 (`http.auth: {type: bearer|basic|apikey}`, `body: {type: json, data}`,
 * `headers: [{name, value}]`, `environments/<Name>.yml: {name, variables: [{name, value}]}`).
 */
function requestYaml(r: InlineRequest, seq: number): string {
  const http: Record<string, unknown> = { method: r.method, url: r.url };
  if (r.params.length) http['params'] = r.params.map((p) => ({ name: p.name, value: p.value, type: 'query' }));
  if (r.headers.length) http['headers'] = r.headers.map((h) => ({ name: h.name, value: h.value }));
  if (r.body) http['body'] = { type: r.body.type, data: r.body.data };
  switch (r.auth.type) {
    case 'inherit': http['auth'] = 'inherit'; break;
    case 'none': break;
    case 'bearer': http['auth'] = { type: 'bearer', token: r.auth.token }; break;
    case 'basic': http['auth'] = { type: 'basic', username: r.auth.username, password: r.auth.password }; break;
    case 'apikey': http['auth'] = { type: 'apikey', key: r.auth.key, value: r.auth.value, placement: r.auth.placement }; break;
  }
  const doc: Record<string, unknown> = { info: { name: r.name, type: 'http', seq }, http };
  // `runtime` is where Bruno 4.1 keeps request vars, scripts, tests and assertions (measured S12):
  // scripts are `{type: before-request|after-response|tests, code}`, assertions `{expression, operator, value}`.
  const runtime: Record<string, unknown> = {};
  if (r.variables?.length) runtime['variables'] = r.variables.map((v) => ({ name: v.name, value: v.value }));
  const scripts: Array<{ type: string; code: string }> = [];
  if (r.scripts?.beforeRequest) scripts.push({ type: 'before-request', code: r.scripts.beforeRequest });
  if (r.scripts?.afterResponse) scripts.push({ type: 'after-response', code: r.scripts.afterResponse });
  if (r.scripts?.tests) scripts.push({ type: 'tests', code: r.scripts.tests });
  if (scripts.length) runtime['scripts'] = scripts;
  if (r.assertions?.length) runtime['assertions'] = r.assertions.map((a) => ({ expression: a.expression, operator: a.operator, value: a.value }));
  if (Object.keys(runtime).length) doc['runtime'] = runtime;
  if (r.docs) doc['docs'] = r.docs;
  doc['settings'] = { encodeUrl: true, timeout: 0, followRedirects: true, maxRedirects: 5 };
  return toYaml(doc, { lineWidth: 0 });
}

export async function writeInlineCollection(dir: string, c: InlineCollection): Promise<{ collectionPath: string; name: string }> {
  await mkdir(path.join(dir, 'environments'), { recursive: true });
  await writeFile(path.join(dir, 'opencollection.yml'), toYaml({
    opencollection: '1.0.0',
    info: { name: c.name, description: c.description || undefined },
    bundled: false,
    extensions: { bruno: { ignore: ['node_modules', '.git'] } },
  }, { lineWidth: 0 }), 'utf8');
  for (const [i, r] of c.requests.entries()) await writeFile(path.join(dir, `${r.name}.yml`), requestYaml(r, i + 1), 'utf8');
  for (const e of c.environments) {
    await writeFile(path.join(dir, 'environments', `${e.name}.yml`), toYaml({ name: e.name, variables: e.variables.map((v) => ({ name: v.name, value: v.value })) }, { lineWidth: 0 }), 'utf8');
  }
  for (const f of c.files) {
    const target = path.join(path.dirname(dir), f.path);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, f.content, 'utf8');
  }
  return { collectionPath: dir, name: c.name };
}
