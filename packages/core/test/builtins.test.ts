import { stat } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createDefaultActionRegistry, REGIONS, STATES } from '@bruno-capture/automation';
import { BUILT_IN_PRESETS, resolveParameters, type Step, type WorkflowDefinition } from '@bruno-capture/shared';
import { WorkflowRegistry, builtInWorkflowsDir, bundledFixturesDir, findCollection } from '../src/index.js';
import { templateValue } from '../src/run/executor.js';

/**
 * The shipped `workflows/` + `fixtures/` directories must load cleanly, and every step must reference a
 * registered action with parameters that satisfy its schema once the workflow's parameter defaults are
 * templated in. This catches typos in action ids, param names, enum values, states and regions without Bruno.
 */
describe('built-in workflows', () => {
  const registry = new WorkflowRegistry({ builtInDir: builtInWorkflowsDir(), fixturesDir: bundledFixturesDir(), sources: () => ({ schemaVersion: 1, customDirectories: [], importedFiles: [] }) });
  const actions = createDefaultActionRegistry();

  it('all load, are valid and have unique ids', async () => {
    const snap = await registry.refresh();
    const invalid = snap.workflows.filter((w) => !w.definition).map((w) => `${w.file}: ${w.issues.map((i) => `${i.path} ${i.message}`).join('; ')}`);
    expect(invalid).toEqual([]);
    expect(snap.total).toBeGreaterThanOrEqual(19);
    const ids = snap.workflows.map((w) => w.definition!.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every action step matches a registered action schema with default parameters applied', async () => {
    await registry.refresh();
    const problems: string[] = [];
    for (const lw of registry.list()) {
      const def = lw.definition as WorkflowDefinition;
      const resolved = resolveParameters(def.parameters, {});
      if (!resolved.ok) { problems.push(`${def.id}: parameters without defaults: ${resolved.errors.map((e) => e.parameter).join(', ')}`); continue; }
      def.steps.forEach((step: Step, i) => {
        if ('action' in step) {
          const action = actions.get(step.action);
          if (!action) { problems.push(`${def.id} step ${i + 1}: unknown action ${step.action}`); return; }
          let params: unknown;
          try { params = templateValue(step.params, resolved.values); } catch (e) { problems.push(`${def.id} step ${i + 1}: ${(e as Error).message}`); return; }
          const parsed = action.params.safeParse(params);
          if (!parsed.success) problems.push(`${def.id} step ${i + 1} (${step.action}): ${parsed.error.issues.map((x) => `${x.path.join('.')} ${x.message}`).join('; ')}`);
        }
        if ('waitFor' in step && step.waitFor.state && !(step.waitFor.state in STATES)) problems.push(`${def.id} step ${i + 1}: unknown state ${step.waitFor.state}`);
        for (const key of ['capture', 'startRecording'] as const) {
          const target = (step as unknown as Record<string, { region?: string } | undefined>)[key];
          if (target?.region && !(target.region in REGIONS)) problems.push(`${def.id} step ${i + 1}: unknown region ${target.region}`);
        }
      });
      if (def.defaults.preset) {
        const preset = BUILT_IN_PRESETS.find((p) => p.id === def.defaults.preset);
        if (!preset) problems.push(`${def.id}: unknown default preset ${def.defaults.preset}`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('every bundled fixture has a collection whose name the workflow opens', async () => {
    await registry.refresh();
    for (const lw of registry.list()) {
      const def = lw.definition as WorkflowDefinition;
      if (def.fixture?.source !== 'bundled') continue;
      const dir = path.join(bundledFixturesDir(), def.fixture.path);
      expect((await stat(dir)).isDirectory(), dir).toBe(true);
      const col = await findCollection(dir);
      // The first collection.open must name the fixture's collection. Fixtures may ship no collection at all
      // (e.g. import/petstore-spec: only a spec, the workspace starts empty) — then nothing is opened before it is created/imported.
      const opened = def.steps.find((s): s is Extract<Step, { action: string }> => 'action' in s && s.action === 'collection.open');
      if (col) { if (opened && !def.steps.some((s) => 'action' in s && ['collection.importFile', 'collection.create'].includes(s.action))) expect((opened.params as { name: string }).name, `${def.id} opens a collection that is not in its fixture`).toBe(col.name); }
      else expect(def.steps.some((s) => 'action' in s && ['collection.importFile', 'collection.create'].includes(s.action)), `${def.id}: fixture ${dir} has no collection and the workflow never imports or creates one`).toBe(true);
    }
  });
});
