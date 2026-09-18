import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { AIProviderId } from '@bruno-capture/shared';

const execFileP = promisify(execFile);
export const KEYCHAIN_SERVICE = 'com.usebruno.capture';
const ENV_VAR: Record<AIProviderId, string> = { openai: 'OPENAI_API_KEY', anthropic: 'ANTHROPIC_API_KEY' };

/**
 * PRD §12: keys live in the macOS Keychain (login keychain, generic password items). The `security`
 * CLI is driven in interactive mode over stdin so the secret never appears in a process list.
 */
export class Keychain {
  constructor(private readonly service = KEYCHAIN_SERVICE) {}

  async get(provider: AIProviderId): Promise<string | undefined> {
    try {
      const { stdout } = await execFileP('/usr/bin/security', ['find-generic-password', '-s', this.service, '-a', provider, '-w'], { timeout: 10_000 });
      const v = stdout.trim();
      return v || undefined;
    } catch { return undefined; }
  }

  async set(provider: AIProviderId, key: string): Promise<void> {
    if (!key || /\s/.test(key)) throw new Error('API key must be a single non-empty token');
    await new Promise<void>((resolve, reject) => {
      const p = spawn('/usr/bin/security', ['-i'], { stdio: ['pipe', 'pipe', 'pipe'] });
      let err = '';
      p.stderr.on('data', (d) => { err += d; });
      p.on('error', reject);
      p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`security exited ${code}: ${err.trim().split('\n')[0]}`))));
      const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
      p.stdin.write(`add-generic-password -U -s ${q(this.service)} -a ${q(provider)} -l ${q(`Bruno Capture (${provider})`)} -w ${q(key)}\n`);
      p.stdin.end();
    });
  }

  async delete(provider: AIProviderId): Promise<boolean> {
    try { await execFileP('/usr/bin/security', ['delete-generic-password', '-s', this.service, '-a', provider], { timeout: 10_000 }); return true; }
    catch { return false; }
  }
}

/** Env var overrides Keychain (PRD §12 dev override). */
export async function resolveApiKey(provider: AIProviderId, keychain = new Keychain()): Promise<{ key?: string; source?: 'env' | 'keychain' }> {
  const env = process.env[ENV_VAR[provider]];
  if (env) return { key: env, source: 'env' };
  const k = await keychain.get(provider);
  return k ? { key: k, source: 'keychain' } : {};
}
