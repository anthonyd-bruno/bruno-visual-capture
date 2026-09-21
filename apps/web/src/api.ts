import type { AIAttribution, AIProviderId, Capabilities, CaptureOverrides, CapturePlan, CapturePreset, ConfidenceBand, CreateRunRequestInput, OutputType, RunEvent, RunManifest, Settings, SettingsPatch, SystemStatus, WorkflowDefinitionInput, WorkflowSummary } from '@bruno-capture/shared';

export class ApiError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string, public readonly details?: unknown) { super(message); }
}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) { const e = body?.error ?? {}; throw new ApiError(res.status, e.code ?? 'error', e.message ?? res.statusText, e.details); }
  return body as T;
}

export type WorkflowSource = 'built-in' | 'generated' | 'custom-directory' | 'imported';
export interface WorkflowListItem {
  id?: string; file: string; source: WorkflowSource; sourcePath: string; importId?: string; valid: boolean;
  issues: Array<{ path: string; message: string }>; summary?: WorkflowSummary; loadedAt: string;
}

export type Issue = { path: string; message: string };
export type PlanFailureResponse = { ok: false; error: { code: string; message: string; hint?: string }; suggestions: WorkflowSummary[] };
export type ReusePlanResponse = { ok: true; kind: 'reuse'; plan: CapturePlan; band: ConfidenceBand; workflow: WorkflowSummary; preset: CapturePreset; parameters: Record<string, string | number | boolean>; attribution: AIAttribution; suggestions: WorkflowSummary[] };
/** Phase 9: a freshly composed workflow — not saved until Generate/Save. */
export type ComposePlanResponse = {
  ok: true; kind: 'compose'; plan: CapturePlan; band: ConfidenceBand; confidence: number; rationale: string;
  definition: WorkflowDefinitionInput; yaml: string; preset: CapturePreset; output: 'screenshots' | 'video' | 'gif';
  captureIds: string[]; fixture: { source: string; path?: string; collection?: string; requests?: number; environments?: number };
  stepCount: number; debt: number; primitives: number; attribution: AIAttribution; suggestions: WorkflowSummary[];
};
export type PlanResponse = ReusePlanResponse | ComposePlanResponse | PlanFailureResponse;
/** Phase 10: an adjusted workflow + settings, not yet saved. */
export type DiffLine = { kind: 'same' | 'added' | 'removed'; line: string };
export type RefineResponse =
  | {
      ok: true; kind: 'refine'; source: { workflowId: string; workflowSource: string; runId?: string };
      definition: WorkflowDefinitionInput; yaml: string; output: 'screenshots' | 'video' | 'gif'; preset: CapturePreset; overrides: CaptureOverrides;
      changes: string[]; settingsChanged: string[]; diff: DiffLine[]; rationale: string; confidence: number; band: ConfidenceBand; debt: number;
      captureIds: string[]; stepCount: number; prompt?: string; feedback: string[]; attribution: AIAttribution;
    }
  | { ok: false; error: { code: string; message: string; hint?: string } };
export type RefineFrom = { runId?: string; workflowId?: string; definition?: WorkflowDefinitionInput; output?: 'screenshots' | 'video' | 'gif'; preset?: string; overrides?: CaptureOverrides };
export type ApplyRefineBody = { workflowId: string; definition: WorkflowDefinitionInput; output: 'screenshots' | 'video' | 'gif'; preset: string; overrides?: CaptureOverrides; prompt?: string; feedback: string[]; refinedFrom?: string; ai?: AIAttribution; cancelActive?: boolean; allowRelaunch?: boolean };
export type RegenerateReview = { kind: 'review'; reason: string; issues: Issue[]; prefill: { workflowId: string; output: OutputType; preset: string; parameters: Record<string, string | number | boolean>; overrides: Record<string, unknown> } };
export type RegenerateResponse = { run: RunManifest; review?: undefined } | { review: RegenerateReview; run?: undefined };

/** Regenerate from anywhere: start the run, or hand the review to the Capture form (PRD §71). */
export async function regenerateAndGo(runId: string, mode: 'exact' | 'latest', onError: (m: string) => void): Promise<void> {
  try {
    const r = await api.regenerate(runId, mode);
    if (r.run) { location.hash = `#/run/${r.run.runId}`; return; }
    const p = r.review!.prefill;
    const q = new URLSearchParams({ workflow: p.workflowId, output: p.output, preset: p.preset, params: JSON.stringify(p.parameters), review: `${r.review!.reason}: ${r.review!.issues.map((i) => `${i.path} ${i.message}`).join('; ')}` });
    location.hash = `#/capture?${q.toString()}`;
  } catch (e) { onError((e as Error).message); }
}
export type SecretsView = { openai: { keyPresent: boolean; source: 'env' | 'keychain' | null }; anthropic: { keyPresent: boolean; source: 'env' | 'keychain' | null } };

export const api = {
  systemStatus: () => call<SystemStatus>('/api/system/status'),
  settings: () => call<{ settings: Settings; secrets: SecretsView; paths: { root: string; artifactRoot: string } }>('/api/settings'),
  plan: (prompt: string, output: OutputType | 'auto', mode: 'auto' | 'pick' | 'compose' = 'auto') => call<PlanResponse>('/api/plan', { method: 'POST', body: JSON.stringify({ prompt, output, mode }) }),
  testProvider: (p: AIProviderId) => call<{ ok: boolean; message: string; model: string; latencyMs?: number }>(`/api/ai/${p}/test`, { method: 'POST' }),
  setKey: (p: AIProviderId, key: string) => call<{ keyPresent: boolean }>(`/api/ai/${p}/key`, { method: 'PUT', body: JSON.stringify({ key }) }),
  deleteKey: (p: AIProviderId) => call<{ keyPresent: boolean }>(`/api/ai/${p}/key`, { method: 'DELETE' }),
  patchSettings: (patch: SettingsPatch) => call<{ settings: Settings }>('/api/settings', { method: 'PUT', body: JSON.stringify(patch) }),
  workflows: () => call<{ workflows: WorkflowListItem[]; refreshedAt: string }>('/api/workflows'),
  workflow: (id: string) => call<WorkflowListItem & { rawText: string }>(`/api/workflows/${encodeURIComponent(id)}`),
  refreshWorkflows: () => call<{ total: number; invalid: number }>('/api/workflows/refresh', { method: 'POST' }),
  importWorkflow: (path: string) => call<{ importId: string; valid: boolean; issues: Issue[] }>('/api/workflows/import', { method: 'POST', body: JSON.stringify({ path }) }),
  removeImport: (id: string) => call<{ removed: string }>(`/api/workflows/import/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  addDirectory: (path: string) => call<{ directories: string[] }>('/api/workflows/directories', { method: 'POST', body: JSON.stringify({ path }) }),
  removeDirectory: (path: string) => call<{ directories: string[] }>('/api/workflows/directories', { method: 'DELETE', body: JSON.stringify({ path }) }),
  /** Phase 10 */
  refine: (feedback: string, from: RefineFrom) => call<RefineResponse>('/api/refine', { method: 'POST', body: JSON.stringify({ feedback, ...from }) }),
  applyRefine: (body: ApplyRefineBody) => call<{ run: RunManifest; workflowId: string; savedAs: 'updated' | 'created' }>('/api/refine/apply', { method: 'POST', body: JSON.stringify(body) }),
  /** Phase 9 */
  validateWorkflow: (yaml: string) => call<{ valid: boolean; issues: Issue[]; captureIds?: string[]; stepCount?: number; yaml?: string }>('/api/workflows/validate', { method: 'POST', body: JSON.stringify({ yaml }) }),
  saveGenerated: (body: { yaml: string; prompt?: string; provider?: string; model?: string }) => call<{ id: string; file: string; valid: boolean; issues: Issue[] }>('/api/workflows/generated', { method: 'POST', body: JSON.stringify(body) }),
  updateGenerated: (id: string, yaml: string) => call<{ id: string; valid: boolean; issues: Issue[] }>(`/api/workflows/generated/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify({ yaml }) }),
  deleteGenerated: (id: string) => call<{ removed: string | null }>(`/api/workflows/generated/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  capabilities: () => call<Capabilities>('/api/capabilities'),
  runs: () => call<{ runs: RunManifest[]; activeRunId: string | null }>('/api/runs'),
  run: (id: string) => call<{ run: RunManifest; active: boolean }>(`/api/runs/${id}`),
  createRun: (req: CreateRunRequestInput) => call<{ run: RunManifest }>('/api/runs', { method: 'POST', body: JSON.stringify(req) }),
  cancelRun: (id: string) => call<{ cancelled: boolean }>(`/api/runs/${id}/cancel`, { method: 'POST' }),
  deleteRun: (id: string) => call<{ deleted: string }>(`/api/runs/${id}`, { method: 'DELETE' }),
  regenerate: (id: string, mode: 'exact' | 'latest', extra: { cancelActive?: boolean; allowRelaunch?: boolean } = {}) => call<RegenerateResponse>(`/api/runs/${id}/regenerate`, { method: 'POST', body: JSON.stringify({ mode, ...extra }) }),
  fileUrl: (runId: string, relativePath: string, download = false) => `/api/runs/${runId}/files/${relativePath}${download ? '?download=1' : ''}`,
  archiveUrl: (runId: string, files?: string[]) => `/api/runs/${runId}/archive${files?.length ? `?files=${encodeURIComponent(files.join(','))}` : ''}`,
  reveal: (runId: string, path?: string) => call<{ revealed: string }>(`/api/runs/${runId}/reveal`, { method: 'POST', body: JSON.stringify(path ? { path } : {}) }),
  openFile: (runId: string, path: string) => call<{ opened: string }>(`/api/runs/${runId}/open`, { method: 'POST', body: JSON.stringify({ path }) }),
};

/** SSE subscription (PRD §66). Returns an unsubscribe function. */
export function subscribeRun(runId: string, onEvent: (e: RunEvent) => void, onEnd?: () => void): () => void {
  const es = new EventSource(`/api/runs/${runId}/events`);
  const types: RunEvent['type'][] = ['run.status', 'workflow.started', 'workflow.step.started', 'workflow.step.completed', 'workflow.step.failed', 'workflow.healing', 'workflow.healed', 'workflow.heal.failed', 'preview.frame', 'artifact.created', 'recording.started', 'recording.stopped', 'processing.started', 'processing.completed', 'run.completed', 'run.failed', 'run.cancelled', 'run.log'];
  for (const t of types) es.addEventListener(t, (ev) => onEvent(JSON.parse((ev as MessageEvent).data) as RunEvent));
  es.onerror = () => { es.close(); onEnd?.(); };
  return () => es.close();
}
