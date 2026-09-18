import { cp, mkdir, readFile, readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { ResolvedParameters, WorkflowDefinition } from '@bruno-capture/shared';

export interface StagedFixture {
  /** Directory Bruno-facing paths are resolved against. */
  workspacePath: string;
  /** The collection directory inside it (has opencollection.yml or bruno.json). */
  collectionPath?: string;
  collectionName?: string;
  /** True when we created the directory and may delete it after a successful run (PRD §45). */
  temporary: boolean;
}

export class FixtureError extends Error {
  readonly code = 'fixture_failed';
  constructor(message: string, public readonly hint?: string) { super(message); this.name = 'FixtureError'; }
}

async function isDir(p: string): Promise<boolean> { return stat(p).then((s) => s.isDirectory()).catch(() => false); }
async function isFile(p: string): Promise<boolean> { return stat(p).then((s) => s.isFile()).catch(() => false); }

/** Find the Bruno collection inside a fixture directory: `<dir>/collection`, `<dir>` itself, or the first child with a collection marker. */
export async function findCollection(dir: string): Promise<{ path: string; name: string } | undefined> {
  const candidates = [path.join(dir, 'collection'), dir];
  for (const child of (await readdir(dir, { withFileTypes: true }).catch(() => [])).filter((e) => e.isDirectory())) candidates.push(path.join(dir, child.name));
  for (const c of candidates) {
    const yml = path.join(c, 'opencollection.yml');
    if (await isFile(yml)) {
      const doc = parseYaml(await readFile(yml, 'utf8')) as { info?: { name?: string } } | null;
      return { path: c, name: doc?.info?.name ?? path.basename(c) };
    }
    const brunoJson = path.join(c, 'bruno.json');
    if (await isFile(brunoJson)) {
      const doc = JSON.parse(await readFile(brunoJson, 'utf8')) as { name?: string };
      return { path: c, name: doc.name ?? path.basename(c) };
    }
  }
  return undefined;
}

export interface StageFixtureOptions {
  fixturesDir: string;
  /** Where copies go. Bundled fixtures always copy (source is never modified, PRD §44). */
  targetDir: string;
  parameters: ResolvedParameters;
  /** Reuse an existing copy at targetDir (user-profile mode keeps a stable path mounted). */
  refreshInPlace?: boolean;
}

export async function stageFixture(def: WorkflowDefinition, opts: StageFixtureOptions): Promise<StagedFixture | undefined> {
  const fx = def.fixture;
  if (!fx) return undefined;

  if (fx.source === 'bundled') {
    const src = path.join(opts.fixturesDir, fx.path);
    if (!(await isDir(src))) throw new FixtureError(`Bundled fixture not found: ${src}`, 'Reinstall Bruno Capture or fix the workflow\'s fixture.path.');
    await rm(opts.targetDir, { recursive: true, force: true });
    await mkdir(path.dirname(opts.targetDir), { recursive: true });
    await cp(src, opts.targetDir, { recursive: true });
    const col = await findCollection(opts.targetDir);
    return { workspacePath: opts.targetDir, collectionPath: col?.path, collectionName: col?.name, temporary: !opts.refreshInPlace };
  }

  const value = opts.parameters[fx.parameter];
  if (typeof value !== 'string' || !value) throw new FixtureError(`Fixture parameter "${fx.parameter}" has no path value`, 'Provide the fixture path in the run parameters.');
  const src = path.resolve(value);
  if (!(await isDir(src))) throw new FixtureError(`Fixture directory not found: ${src}`);
  if (!fx.copy) {
    const col = await findCollection(src);
    return { workspacePath: src, collectionPath: col?.path, collectionName: col?.name, temporary: false };
  }
  await rm(opts.targetDir, { recursive: true, force: true });
  await mkdir(path.dirname(opts.targetDir), { recursive: true });
  await cp(src, opts.targetDir, { recursive: true });
  const col = await findCollection(opts.targetDir);
  return { workspacePath: opts.targetDir, collectionPath: col?.path, collectionName: col?.name, temporary: true };
}
