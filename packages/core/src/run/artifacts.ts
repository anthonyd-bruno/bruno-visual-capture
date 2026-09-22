import { appendFile, mkdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Artifact, ArtifactKind, RunManifest } from '@bruno-capture/shared';
import { writeJsonFile } from '../json-file.js';

export function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'capture';
}

export function pngDimensions(png: Buffer): { width: number; height: number } | undefined {
  if (png.length < 24 || png.toString('ascii', 1, 4) !== 'PNG') return undefined;
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

/**
 * One immutable run directory (PRD §67–§70). Human-readable filenames (§75), no overwrites: a
 * second `runner-open` in one run becomes `runner-open-2.png`.
 */
export class RunArtifactStore {
  readonly screenshotsDir: string;
  readonly videoDir: string;
  readonly gifDir: string;
  readonly debugDir: string;
  readonly debugWorkspaceDir: string;
  readonly logFile: string;
  readonly manifestFile: string;
  readonly snapshotFile: string;
  private readonly used = new Set<string>();
  private readonly artifacts: Artifact[] = [];

  private constructor(public readonly runId: string, public readonly runDir: string) {
    this.screenshotsDir = path.join(runDir, 'screenshots');
    this.videoDir = path.join(runDir, 'video');
    this.gifDir = path.join(runDir, 'gif');
    this.debugDir = path.join(runDir, 'debug');
    this.debugWorkspaceDir = path.join(this.debugDir, 'workspace');
    this.logFile = path.join(this.debugDir, 'run.log');
    this.manifestFile = path.join(runDir, 'manifest.json');
    this.snapshotFile = path.join(runDir, 'workflow.yaml');
  }

  static async create(artifactRoot: string, runId: string): Promise<RunArtifactStore> {
    const store = new RunArtifactStore(runId, path.join(artifactRoot, runId));
    await mkdir(store.debugDir, { recursive: true });
    await writeFile(store.logFile, '', { flag: 'a' });
    return store;
  }

  private uniqueName(dir: string, base: string, ext: string): string {
    let name = `${base}${ext}`;
    for (let i = 2; this.used.has(path.join(dir, name)); i++) name = `${base}-${i}${ext}`;
    this.used.add(path.join(dir, name));
    return name;
  }

  async addScreenshot(captureId: string, png: Buffer): Promise<Artifact> {
    await mkdir(this.screenshotsDir, { recursive: true });
    const fileName = this.uniqueName(this.screenshotsDir, slugify(captureId), '.png');
    const file = path.join(this.screenshotsDir, fileName);
    await writeFile(file, png);
    const dims = pngDimensions(png);
    const artifact: Artifact = {
      id: `${this.runId}:${fileName}`, kind: 'screenshot', captureId, fileName,
      relativePath: path.posix.join('screenshots', fileName), mimeType: 'image/png', bytes: png.length,
      width: dims?.width, height: dims?.height, createdAt: new Date().toISOString(),
    };
    this.artifacts.push(artifact);
    return artifact;
  }

  /** Move a finished MP4/GIF into the run directory. */
  async addMedia(kind: 'video' | 'gif', sourceFile: string, baseName: string, meta: { width?: number; height?: number; durationMs?: number; fps?: number }): Promise<Artifact> {
    const dir = kind === 'video' ? this.videoDir : this.gifDir;
    await mkdir(dir, { recursive: true });
    const ext = kind === 'video' ? '.mp4' : '.gif';
    const fileName = this.uniqueName(dir, slugify(baseName), ext);
    const file = path.join(dir, fileName);
    await rename(sourceFile, file);
    const { size } = await stat(file);
    const artifact: Artifact = {
      id: `${this.runId}:${fileName}`, kind, captureId: slugify(baseName), fileName,
      relativePath: path.posix.join(kind, fileName), mimeType: kind === 'video' ? 'video/mp4' : 'image/gif', bytes: size,
      ...meta, createdAt: new Date().toISOString(),
    };
    this.artifacts.push(artifact);
    return artifact;
  }

  list(): Artifact[] { return [...this.artifacts]; }

  /** Drop every artifact of one kind — files and entries — e.g. the stills of a take that is being re-recorded. */
  async discard(kind: ArtifactKind): Promise<number> {
    const dropped = this.artifacts.filter((a) => a.kind === kind);
    for (const a of dropped) {
      const file = path.join(this.runDir, a.relativePath);
      await rm(file, { force: true }).catch(() => undefined);
      this.used.delete(file);
    }
    this.artifacts.splice(0, this.artifacts.length, ...this.artifacts.filter((a) => a.kind !== kind));
    return dropped.length;
  }

  async writeSnapshot(yamlText: string): Promise<void> { await writeFile(this.snapshotFile, yamlText, 'utf8'); }
  async writeManifest(manifest: RunManifest): Promise<void> { await writeJsonFile(this.manifestFile, manifest); }

  /** NDJSON log line (PRD §93). Never log secrets — callers redact before this point. */
  async log(entry: Record<string, unknown>): Promise<void> {
    await appendFile(this.logFile, JSON.stringify({ at: new Date().toISOString(), ...entry }) + '\n', 'utf8').catch(() => undefined);
  }
}
