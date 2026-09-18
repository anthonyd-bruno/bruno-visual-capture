import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { z } from 'zod';

export class JsonFileError extends Error {
  constructor(public readonly file: string, message: string, public readonly issues?: z.core.$ZodIssue[]) {
    super(`${file}: ${message}`);
    this.name = 'JsonFileError';
  }
}

/** Read + validate a JSON file. Missing file → `undefined`. Invalid content throws with Zod issues. */
export async function readJsonFile<S extends z.ZodType>(file: string, schema: S): Promise<z.output<S> | undefined> {
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw e;
  }
  let raw: unknown;
  try { raw = JSON.parse(text); } catch (e) { throw new JsonFileError(file, `not valid JSON (${(e as Error).message})`); }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new JsonFileError(file, 'failed validation', parsed.error.issues);
  return parsed.data;
}

/** Atomic write: temp file in the same directory, then rename, so a crash never leaves half a file. */
export async function writeJsonFile(file: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, JSON.stringify(value, null, 2) + '\n', 'utf8');
  await rename(tmp, file);
}
