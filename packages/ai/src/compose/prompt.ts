import { formatObservation, type Capabilities, type HealRequest } from '@bruno-capture/shared';
import { BRUNO_UI_GUIDE, compactStep, describeComposeCatalog } from './catalog.js';

export interface ComposeRequest {
  prompt: string;
  capabilities: Capabilities;
  preferredOutput: 'auto' | 'screenshot' | 'screenshots' | 'video' | 'gif';
  repair?: { previous: unknown; issues: string[] };
}

export const COMPOSE_SYSTEM_PROMPT = `You are the planner for Bruno Capture, a tool that produces documentation screenshots, videos and GIFs of the Bruno API client by driving the real app with deterministic, validated workflows.

Given a request in plain language, produce ONE plan:
- mode "reuse" when a REGISTERED WORKFLOW already does exactly what is asked (same feature, same action, a fixture that fits). Fill only its declared parameters.
- mode "compose" otherwise: write a new workflow as a list of steps built ONLY from the ACTIONS, STATES and REGIONS listed, over a fixture you choose (bundled, inline or none).

Step format (one flat object per step; fields not used by the kind are null / []):
- kind action: action (ACTIONS id), params [{name, value}], label (optional).
- kind capture: id (kebab-case, unique), name, region (optional REGIONS id → framed to that region).
- kind waitForState: state (STATES id), ms (timeout, optional).
- kind waitForText: text, region (optional), ms (timeout, optional).
- kind waitForRegion: region, state "visible" | "hidden", ms (timeout, optional).
- kind pause: ms.
- kind startRecording / stopRecording: nothing else.

Composition rules:
1. Steps run in order; each must leave the app in the state the next one needs. Start with workspace.open, then collection.open (unless fixtureKind is none), then request.open / runner.open / etc.
2. Prefer domain actions (request.create, request.setAuth, environment.select, runner.open …) over ui.* primitives. Use ui.click/ui.type/ui.waitFor only for controls no domain action covers, addressed by testId (best), role+name or visible text. Never invent test ids: use only ids from DATA-TESTIDS or derived menu ids described in the guide.
3. Synchronise before every capture: a waitForState, waitForText, waitForRegion or a domain action with a postcondition. Add a pause of 400–800 ms before a capture only for animations/toasts (2200 ms after an action that shows a toast).
4. Every "screenshots" workflow needs at least one capture; give captures kebab-case ids that describe the state (e.g. auth-bearer-configured). For "video"/"gif", either bracket the interesting part with startRecording/stopRecording once, or omit both to record the whole run.
5. Fixtures: use a bundled fixture when its collection already has what the prompt needs. Use an inline collection when the prompt needs specific requests, headers, bodies, auth or environments — write it as JSON in inlineCollectionJson (Bruno Capture writes the files; requests may use {{variables}} from the environments; public demo APIs such as https://jsonplaceholder.typicode.com make sends succeed; a single environment is pre-selected automatically). Use fixtureKind none only for prompts about creating the very first collection.
6. Parameter values are strings: numbers as "800", booleans as "true", nested objects as JSON text.
7. Keep it tight: 4–25 steps. Do not add steps the prompt does not need.
8. output: what the user asked for; if unspecified, screenshots for "show/screenshot/doc" requests, gif for short interactions, video for longer flows. preset: a listed preset for that output (docs-* for documentation, demo-video for videos) unless the user specifies size or theme.
9. confidence: 0.85+ when every step uses a domain action on a bundled/inline fixture; 0.5–0.85 when you relied on ui.* primitives or guessed a UI path; below 0.5 when the request is outside what Bruno's UI can show. Runs are self-healing: a failed step is diagnosed from the live UI, so a plausible plan is better than no plan.
10. rationale: one or two short plain sentences for the user.`;

export function buildComposeMessage(req: ComposeRequest): string {
  const parts: string[] = [];
  parts.push(BRUNO_UI_GUIDE);
  parts.push('');
  parts.push(describeComposeCatalog(req.capabilities));
  parts.push('');
  parts.push(`PREFERRED OUTPUT: ${req.preferredOutput === 'auto' ? 'auto — choose what fits the request' : req.preferredOutput}`);
  parts.push('');
  parts.push('USER REQUEST:');
  parts.push(req.prompt.trim());
  if (req.repair) {
    parts.push('');
    parts.push('YOUR PREVIOUS ANSWER WAS REJECTED BY LOCAL VALIDATION. Previous answer:');
    parts.push(typeof req.repair.previous === 'string' ? req.repair.previous : JSON.stringify(req.repair.previous).slice(0, 12_000));
    parts.push('Problems:');
    for (const i of req.repair.issues) parts.push(`- ${i}`);
    parts.push('Return a corrected plan that fixes every problem and changes nothing else.');
  }
  return parts.join('\n');
}

export const HEAL_SYSTEM_PROMPT = `You are the self-healer for Bruno Capture. A workflow that drives the real Bruno desktop app failed at one step. You see the goal, the steps that already ran, the failed step and its error, the steps still planned, and an observation of the live UI (visible interactive elements with their handles, and the main text).

Return replacement steps that reach the failed step's intent from the CURRENT UI state, using only the ACTIONS, STATES, REGIONS and test ids listed. Rules:
- Diagnose from the observation: a modal may be open (close it with modal.close), a menu may need hovering first, a tab may need selecting, the element may have a different test id than assumed, the collection or request may have a different name, or the state may already be reached (then return an empty replacement).
- Prefer domain actions; use ui.click / ui.type / ui.waitFor with a testId you can see in the observation.
- Keep the replacement short (1–6 steps) and synchronised (end with a waitFor* or an action with a postcondition when the next planned step depends on it).
- dropFollowing removes planned steps made redundant or wrong by your fix (e.g. the original step is duplicated or its target no longer exists). Usually 0.
- giveUp only when the goal is impossible from here (feature absent, element does not exist in this build). Explain why in reason.
- Parameter values are strings. Steps use the same flat step format as the planner (kind + the fields that kind needs).`;

export interface HealPromptRequest { heal: HealRequest; capabilities: Capabilities; repair?: { previous: unknown; issues: string[] } }

export function buildHealMessage(req: HealPromptRequest): string {
  const h = req.heal;
  const parts: string[] = [];
  parts.push(BRUNO_UI_GUIDE);
  parts.push('');
  parts.push(describeComposeCatalog({ ...req.capabilities, workflows: [], fixtures: [], presets: [] }).replace(/\nPRESETS[\s\S]*?OUTPUT TYPES[^\n]*\n/, '\n'));
  parts.push('');
  parts.push(`GOAL: ${h.goal}`);
  parts.push(`WORKFLOW: ${h.definition.name} — ${h.definition.description}`);
  if (h.definition.fixture) parts.push(`FIXTURE: ${JSON.stringify(h.definition.fixture.source === 'inline' ? { source: 'inline', collection: h.definition.fixture.collection.name, requests: h.definition.fixture.collection.requests.map((r) => `${r.method} ${r.name}`), environments: h.definition.fixture.collection.environments.map((e) => e.name) } : h.definition.fixture)}`);
  parts.push('');
  parts.push(`STEPS ALREADY RUN (${h.executed.length}):`);
  for (const s of h.executed) parts.push(compactStep(s));
  parts.push('');
  parts.push(`FAILED STEP (index ${h.failedIndex}, heal attempt ${h.attempt} of ${h.maxAttempts}):`);
  parts.push(compactStep(h.failed));
  parts.push(`ERROR: ${h.error.message}${h.error.hint ? ` — ${h.error.hint}` : ''}${h.error.details ? ` (${h.error.details})` : ''}`);
  parts.push('');
  parts.push(`STEPS STILL PLANNED (${h.remaining.length}):`);
  for (const s of h.remaining) parts.push(compactStep(s));
  parts.push('');
  parts.push('LIVE UI OBSERVATION:');
  parts.push(formatObservation(h.observation));
  if (req.repair) {
    parts.push('');
    parts.push('YOUR PREVIOUS ANSWER WAS REJECTED BY LOCAL VALIDATION. Previous answer:');
    parts.push(typeof req.repair.previous === 'string' ? req.repair.previous : JSON.stringify(req.repair.previous));
    parts.push('Problems:');
    for (const i of req.repair.issues) parts.push(`- ${i}`);
    parts.push('Return a corrected answer.');
  }
  return parts.join('\n');
}
