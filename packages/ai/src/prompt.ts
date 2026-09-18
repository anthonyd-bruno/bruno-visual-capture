import type { Capabilities, Parameter } from '@bruno-capture/shared';
import type { CapturePlanningRequest } from './types.js';

function describeParameter(name: string, p: Parameter): string {
  const bits: string[] = [p.type];
  if (p.type === 'select') bits.push(`one of: ${p.options.join(' | ')}`);
  if ('default' in p && p.default !== undefined) bits.push(`default ${JSON.stringify(p.default)}`);
  if (p.required) bits.push('required');
  return `    - ${name}: ${bits.join(', ')}${p.description ? ` — ${p.description}` : ''}`;
}

/** Compact, deterministic capability listing (PRD §13). No source code, no selectors, no files. */
export function describeCapabilities(c: Capabilities): string {
  const lines: string[] = [];
  lines.push('WORKFLOWS (choose exactly one id):');
  for (const w of c.workflows.filter((x) => x.valid)) {
    lines.push(`- id: ${w.id}`);
    lines.push(`  name: ${w.name}`);
    lines.push(`  kind: ${w.kind}  feature: ${w.feature}${w.tags.length ? `  tags: ${w.tags.join(', ')}` : ''}`);
    if (w.description) lines.push(`  description: ${w.description}`);
    lines.push(`  supportedOutputs: ${w.supportedOutputs.join(', ')}`);
    if (w.captureIds.length) lines.push(`  screenshots it produces: ${w.captureIds.join(', ')}`);
    const params = Object.entries(w.parameters);
    lines.push(params.length ? '  parameters:' : '  parameters: none');
    for (const [name, p] of params) lines.push(describeParameter(name, p));
  }
  lines.push('');
  lines.push('PRESETS (choose exactly one id whose outputs include your output):');
  for (const p of c.presets) lines.push(`- id: ${p.id}  outputs: ${p.outputs.join(', ')}  ${p.width}${p.height ? `×${p.height}` : ' px wide'}  theme ${p.theme}  cursor ${p.cursor}  — ${p.description}`);
  lines.push('');
  lines.push(`OUTPUT TYPES: ${c.outputs.join(', ')} (screenshot = one still from a capture definition; screenshots = the stills a workflow captures; video = MP4; gif = animated GIF)`);
  return lines.join('\n');
}

export const SYSTEM_PROMPT = `You are the planner for Bruno Capture, a tool that produces documentation screenshots, videos and GIFs of the Bruno API client by running registered, deterministic workflows.

Your only job is to map the user's request onto ONE registered workflow, an output type, a preset, and parameter values. You never invent workflows, steps, selectors or files: everything you may choose from is listed in the capabilities below.

Rules:
- workflowId must be one of the listed ids. Use type "capture" only when that workflow's kind is capture.
- output must be one of that workflow's supportedOutputs. If the user asks for a GIF or video and the workflow supports it, use it; if they ask for a screenshot of a multi-step workflow, use "screenshots".
- preset must be a listed preset whose outputs include the chosen output. Prefer the docs presets for documentation and demo-video for videos unless the user says otherwise.
- parameters may only name parameters the chosen workflow declares; give values as strings; leave out anything the user did not specify so defaults apply.
- confidence: 0.9+ when the request clearly names the feature and action; 0.5–0.8 when you had to infer; below 0.5 when no listed workflow really matches — then still pick the closest and explain in rationale.
- rationale: one or two short sentences in plain language.`;

export function buildUserMessage(req: CapturePlanningRequest): string {
  const parts: string[] = [];
  parts.push(describeCapabilities(req.capabilities));
  parts.push('');
  parts.push(`PREFERRED OUTPUT: ${req.preferredOutput === 'auto' ? 'auto — choose what fits the request' : req.preferredOutput}`);
  parts.push('');
  parts.push('USER REQUEST:');
  parts.push(req.prompt.trim());
  if (req.repair) {
    parts.push('');
    parts.push('YOUR PREVIOUS ANSWER WAS REJECTED. Previous answer:');
    parts.push(typeof req.repair.previous === 'string' ? req.repair.previous : JSON.stringify(req.repair.previous));
    parts.push('Problems:');
    for (const i of req.repair.issues) parts.push(`- ${i}`);
    parts.push('Return a corrected plan that fixes every problem.');
  }
  return parts.join('\n');
}
