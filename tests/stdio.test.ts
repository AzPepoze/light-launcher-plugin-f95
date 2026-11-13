import { describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dir, '..');
/** Set F95_PLUGIN_BIN to smoke-test a compiled binary instead of the source. */
const COMMAND = process.env.F95_PLUGIN_BIN ? [process.env.F95_PLUGIN_BIN] : ['bun', 'src/main.ts'];

type Answer = (params: unknown) => unknown;

interface Reply {
  id: number;
  result?: unknown;
  error?: { code: number; message: string };
}

/**
 * Runs `src/main.ts` as the launcher would and plays the host: it answers the plugin's
 * own requests (settings.get, secrets.get) from `answers`.
 */
class StdioHost {
  readonly proc: Bun.Subprocess<'pipe', 'pipe', 'ignore'>;
  private nextId = 1;
  private readonly pending = new Map<number, (reply: Reply) => void>();
  private readonly badLines: string[] = [];

  constructor(private readonly answers: Record<string, Answer>) {
    this.proc = Bun.spawn(COMMAND, { cwd: ROOT, stdin: 'pipe', stdout: 'pipe', stderr: 'ignore' });
    void this.readStdout();
  }

  request<R = unknown>(method: string, params: object): Promise<R> {
    const id = this.nextId++;
    return new Promise<R>((resolve, reject) => {
      this.pending.set(id, (reply) => {
        if (reply.error) reject(new Error(`${method}: ${reply.error.message}`));
        else resolve(reply.result as R);
      });
      this.send({ jsonrpc: '2.0', id, method, params });
    });
  }

  /** Lines on stdout that were not JSON-RPC messages. The plugin must never print any. */
  stdoutProblems(): string[] {
    return [...this.badLines];
  }

  private send(message: object): void {
    this.proc.stdin.write(`${JSON.stringify(message)}\n`);
    this.proc.stdin.flush();
  }

  private async readStdout(): Promise<void> {
    const decoder = new TextDecoder();
    let rest = '';
    for await (const chunk of this.proc.stdout) {
      const lines = (rest + decoder.decode(chunk, { stream: true })).split('\n');
      rest = lines.pop() ?? '';
      for (const line of lines) if (line.trim()) this.receive(line);
    }
  }

  private receive(line: string): void {
    let message: { id?: number; method?: string; params?: unknown; result?: unknown; error?: Reply['error'] };
    try {
      message = JSON.parse(line);
    } catch {
      this.badLines.push(line);
      return;
    }
    if (message.method !== undefined) {
      if (message.id !== undefined) this.answer(message.id, message.method, message.params);
      return;
    }
    if (message.id !== undefined) this.pending.get(message.id)?.(message as Reply);
  }

  private answer(id: number, method: string, params: unknown): void {
    const answer = this.answers[method];
    if (!answer) {
      this.send({ jsonrpc: '2.0', id, error: { code: -32601, message: `no answer for ${method}` } });
      return;
    }
    this.send({ jsonrpc: '2.0', id, result: answer(params) });
  }
}

describe('stdio', () => {
  test('answers initialize, parseRef and authStatus, then exits on shutdown', async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'f95-stdio-'));
    const host = new StdioHost({
      'settings.get': () => ({ settings: {} }),
      // no cookie stored: authStatus must answer without any network request
      'secrets.get': () => ({ value: null }),
    });
    try {
      const init = await host.request<{
        pluginVersion: string;
        capabilities: Record<string, { browse: boolean; 'browse:filters'?: boolean }>;
      }>(
        'initialize',
        {
          hostVersion: '2.0.0',
          apiVersion: '1',
          platform: 'linux',
          grantedPermissions: { network: [], fs: [], secrets: true, browser: false, exec: false },
          dataDir,
        },
      );
      expect(init.pluginVersion).toBe('1.0.2');
      expect(init.capabilities.f95.browse).toBe(true);
      expect(init.capabilities.f95['browse:filters']).toBe(true);

      expect(await host.request('source.parseRef', { url: 'https://f95zone.to/threads/my-game.12345/' })).toEqual({
        kind: 'game',
        id: '12345',
        url: 'https://f95zone.to/threads/12345/',
      });
      expect(await host.request('source.authStatus', { source: 'f95' })).toMatchObject({ status: 'unconfigured' });

      expect(await host.request('shutdown', {})).toBeNull();
      expect(await host.proc.exited).toBe(0);
      expect(host.stdoutProblems()).toEqual([]);
    } finally {
      host.proc.kill();
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  }, 20_000);

  test('source.parseRef takes only url, as the protocol schema says', async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'f95-stdio-'));
    const host = new StdioHost({});
    try {
      await host.request('initialize', {
        hostVersion: '2.0.0',
        apiVersion: '1',
        platform: 'linux',
        grantedPermissions: { network: [], fs: [], secrets: false, browser: false, exec: false },
        dataDir,
      });
      const url = 'https://f95zone.to/threads/my-game.12345/';
      await expect(host.request('source.parseRef', { url, source: 'f95' })).rejects.toThrow(
        'invalid params for source.parseRef',
      );
      expect(await host.request('source.parseRef', { url })).toMatchObject({ kind: 'game', id: '12345' });
      expect(await host.request('shutdown', {})).toBeNull();
    } finally {
      host.proc.kill();
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  }, 20_000);
});
