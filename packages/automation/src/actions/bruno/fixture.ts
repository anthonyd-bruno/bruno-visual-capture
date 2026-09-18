import { copyFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { ActionError, defineAction } from '../types.js';

const rel = z.string().min(1).refine((s) => !path.isAbsolute(s) && !s.split(/[\\/]/).includes('..'), 'must be a relative path inside the run workspace');

/**
 * Deterministic state change on disk (D11 rung 5): e.g. swap a spec file so OpenAPI Sync detects
 * changes. Confined to the run's fixture workspace; never touches the bundled source (PRD §44).
 */
export const fixtureCopyFile = defineAction({
  id: 'fixture.copyFile',
  description: 'Copy one file over another inside the run workspace (both paths relative to it).',
  retryable: true, rung: 5,
  params: z.object({ from: rel, to: rel }),
  async execute(ctx, p) {
    if (!ctx.workspacePath) throw new ActionError('fixture.copyFile', 'This workflow has no fixture workspace');
    const from = path.join(ctx.workspacePath, p.from), to = path.join(ctx.workspacePath, p.to);
    if (!(await stat(from).then((s) => s.isFile()).catch(() => false))) throw new ActionError('fixture.copyFile', `Source file not found in the workspace: ${p.from}`);
    await copyFile(from, to);
    ctx.log(`copied ${p.from} → ${p.to}`);
  },
});
