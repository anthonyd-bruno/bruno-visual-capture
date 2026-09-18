import type { Capabilities, CreateRunRequestInput, RunEvent, RunManifest, Settings, SettingsPatch, SystemStatus, WorkflowSummary } from '@bruno-capture/shared';

export class ApiError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string, public readonly details?: unknown) { super(message); }
}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) { const e = body?.error ?? {}; throw new ApiError(res.status, e.code ?? 'error', e.message ?? res.statusText, e.details); }
  return body as T;
}

export interface WorkflowListItem {
  id?: string; file: string; source: 'built-in' | 'custom-directory' | 'imported'; sourcePath: string; importId?: string; valid: boolean;
  issues: Array<{ path: string; message: string }>; summary?: WorkflowSummary; loadedAt: string;
}

export const api = {
  systemStatus: () => call<SystemStatus>('/api/system/status'),
  settings: () => call<{ settings: Settings; secrets: { openai: { keyPresent: boolean }; anthropic: { keyPresent: boolean } }; paths: { root: string; artifactRoot: string } }>('/api/settings'),
  patchSettings: (patch: SettingsPatch) => call<{ settings: Settings }>('/api/settings', { method: 'PUT', body: JSON.stringify(patch) }),
  workflows: () => call<{ workflows: WorkflowListItem[]; refreshedAt: string }>('/api/workflows'),
  workflow: (id: string) => call<WorkflowListItem & { rawText: string }>(`/api/workflows/${encodeURIComponent(id)}`),
  refreshWorkflows: () => call<{ total: number; invalid: number }>('/api/workflows/refresh', { method: 'POST' }),
  importWorkflow: (path: string) => call<{ importId: string; valid: boolean; issues: Array<{ path: string; message: string }> }>('/api/workflows/import', { method: 'POST', body: JSON.stringify({ path }) }),
  removeImport: (id: string) => call<{ removed: string }>(`/api/workflows/import/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  addDirectory: (path: string) => call<{ directories: string[] }>('/api/workflows/directories', { method: 'POST', body: JSON.stringify({ path }) }),
  removeDirectory: (path: string) => call<{ directories: string[] }>('/api/workflows/directories', { method: 'DELETE', body: JSON.stringify({ path }) }),
  capabilities: () => call<Capabilities>('/api/capabilities'),
  runs: () => call<{ runs: RunManifest[]; activeRunId: string | null }>('/api/runs'),
  run: (id: string) => call<{ run: RunManifest; active: boolean }>(`/api/runs/${id}`),
  createRun: (req: CreateRunRequestInput) => call<{ run: RunManifest }>('/api/runs', { method: 'POST', body: JSON.stringify(req) }),
  cancelRun: (id: string) => call<{ cancelled: boolean }>(`/api/runs/${id}/cancel`, { method: 'POST' }),
  deleteRun: (id: string) => call<{ deleted: string }>(`/api/runs/${id}`, { method: 'DELETE' }),
  regenerate: (id: string, mode: 'exact' | 'latest') => call<{ run: RunManifest }>(`/api/runs/${id}/regenerate`, { method: 'POST', body: JSON.stringify({ mode }) }),
  fileUrl: (runId: string, relativePath: string, download = false) => `/api/runs/${runId}/files/${relativePath}${download ? '?download=1' : ''}`,
};

/** SSE subscription (PRD §66). Returns an unsubscribe function. */
export function subscribeRun(runId: string, onEvent: (e: RunEvent) => void, onEnd?: () => void): () => void {
  const es = new EventSource(`/api/runs/${runId}/events`);
  const types: RunEvent['type'][] = ['run.status', 'workflow.started', 'workflow.step.started', 'workflow.step.completed', 'workflow.step.failed', 'preview.frame', 'artifact.created', 'recording.started', 'recording.stopped', 'processing.started', 'processing.completed', 'run.completed', 'run.failed', 'run.cancelled', 'run.log'];
  for (const t of types) es.addEventListener(t, (ev) => onEvent(JSON.parse((ev as MessageEvent).data) as RunEvent));
  es.onerror = () => { es.close(); onEnd?.(); };
  return () => es.close();
}
