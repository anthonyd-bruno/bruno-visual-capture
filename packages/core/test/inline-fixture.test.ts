import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { InlineCollectionSchema } from '@bruno-capture/shared';
import { writeInlineCollection } from '../src/run/inline-fixture.js';

let dir: string;
beforeEach(async () => { dir = await mkdtemp(path.join(os.tmpdir(), 'bru-inline-')); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

describe('writeInlineCollection', () => {
  it('writes request vars, scripts, tests and assertions in the `runtime` shape Bruno 4.1 reads', async () => {
    const col = InlineCollectionSchema.parse({
      name: 'Inline Demo',
      environments: [{ name: 'Demo', variables: [{ name: 'baseUrl', value: 'https://jsonplaceholder.typicode.com' }] }],
      requests: [{
        name: 'Get user', url: '{{baseUrl}}/users/{{userId}}',
        variables: [{ name: 'userId', value: '1' }],
        scripts: { beforeRequest: 'bru.setVar("t", 1);', afterResponse: 'bru.setVar("n", res.getBody().name);', tests: 'test("ok", function () { expect(res.getStatus()).to.equal(200); });' },
        assertions: [{ expression: 'res.status', operator: 'eq', value: '200' }, { expression: 'res.body', operator: 'isJson' }],
        docs: '# Get user',
      }],
    });
    const out = await writeInlineCollection(path.join(dir, 'collection'), col);
    expect(out.name).toBe('Inline Demo');
    const doc = parseYaml(await readFile(path.join(dir, 'collection', 'Get user.yml'), 'utf8')) as Record<string, unknown>;
    expect(doc['runtime']).toEqual({
      variables: [{ name: 'userId', value: '1' }],
      scripts: [
        { type: 'before-request', code: 'bru.setVar("t", 1);' },
        { type: 'after-response', code: 'bru.setVar("n", res.getBody().name);' },
        { type: 'tests', code: 'test("ok", function () { expect(res.getStatus()).to.equal(200); });' },
      ],
      assertions: [{ expression: 'res.status', operator: 'eq', value: '200' }, { expression: 'res.body', operator: 'isJson', value: '' }],
    });
    expect(doc['docs']).toBe('# Get user');
    expect((doc['http'] as { auth: unknown }).auth).toBe('inherit');
    expect(Object.keys(doc)).toEqual(['info', 'http', 'runtime', 'docs', 'settings']);
  });

  it('omits `runtime` when a request has none of those features', async () => {
    const col = InlineCollectionSchema.parse({ name: 'Plain', requests: [{ name: 'Ping', url: 'https://example.com' }] });
    await writeInlineCollection(path.join(dir, 'collection'), col);
    const doc = parseYaml(await readFile(path.join(dir, 'collection', 'Ping.yml'), 'utf8')) as Record<string, unknown>;
    expect(doc['runtime']).toBeUndefined();
    expect(Object.keys(doc)).toEqual(['info', 'http', 'settings']);
  });

  it('rejects unknown assertion operators', () => {
    const r = InlineCollectionSchema.safeParse({ name: 'X', requests: [{ name: 'A', url: 'https://example.com', assertions: [{ expression: 'res.status', operator: 'equals' }] }] });
    expect(r.success).toBe(false);
  });
});
