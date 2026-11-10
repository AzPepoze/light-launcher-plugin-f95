import readline from 'node:readline';

/**
 * Newline-delimited JSON-RPC 2.0 over stdio. One JSON object per line.
 * Requests run concurrently; each response carries the id of its request.
 */

export const SHUTDOWN_METHOD = 'shutdown';

export const RPC_ERROR = {
  parse: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internal: -32603,
} as const;

export class RpcError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message);
    this.name = 'RpcError';
  }
}

export type RpcHandler = (params: unknown) => unknown;

interface RpcRequest {
  jsonrpc?: unknown;
  id?: unknown;
  method?: unknown;
  params?: unknown;
}

export class RpcServer {
  /** set by serveStdio: closes the input once the shutdown reply is written */
  onShutdown: (() => void) | null = null;
  private readonly handlers = new Map<string, RpcHandler>();
  private readonly inFlight = new Set<Promise<void>>();

  constructor(private readonly write: (line: string) => void) {}

  handle(method: string, handler: RpcHandler): void {
    this.handlers.set(method, handler);
  }

  /** Sends a notification (no reply expected) to the host. */
  notify(method: string, params: unknown): void {
    this.send({ jsonrpc: '2.0', method, params });
  }

  receive(line: string): void {
    if (!line.trim()) return;
    const job: Promise<void> = this.dispatch(line).finally(() => this.inFlight.delete(job));
    this.inFlight.add(job);
  }

  /** Resolves when every request received so far has been answered. */
  async drain(): Promise<void> {
    await Promise.allSettled([...this.inFlight]);
  }

  private async dispatch(line: string): Promise<void> {
    let request: RpcRequest;
    try {
      request = JSON.parse(line) as RpcRequest;
    } catch {
      this.sendError(null, RPC_ERROR.parse, 'parse error');
      return;
    }
    if (typeof request !== 'object' || request === null || typeof request.method !== 'string') {
      this.sendError(null, RPC_ERROR.invalidRequest, 'invalid request');
      return;
    }

    const isNotification = request.id === undefined;
    try {
      const handler = this.handlers.get(request.method);
      if (!handler) throw new RpcError(RPC_ERROR.methodNotFound, `unknown method: ${request.method}`);
      const result = await handler(request.params ?? {});
      if (!isNotification) this.send({ jsonrpc: '2.0', id: request.id, result: result ?? null });
    } catch (err) {
      if (!isNotification) this.sendFailure(request.id, err);
    } finally {
      if (request.method === SHUTDOWN_METHOD) this.onShutdown?.();
    }
  }

  private sendFailure(id: unknown, err: unknown): void {
    if (err instanceof RpcError) {
      this.sendError(id, err.code, err.message);
      return;
    }
    this.sendError(id, RPC_ERROR.internal, err instanceof Error ? err.message : String(err));
  }

  private sendError(id: unknown, code: number, message: string): void {
    this.send({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });
  }

  private send(message: unknown): void {
    this.write(`${JSON.stringify(message)}\n`);
  }
}

/** Reads requests from stdin until it closes or the host sends `shutdown`. */
export async function serveStdio(server: RpcServer): Promise<void> {
  const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  server.onShutdown = () => lines.close();
  for await (const line of lines) server.receive(line);
  await server.drain();
}

export function paramObject(params: unknown): Record<string, unknown> {
  if (typeof params !== 'object' || params === null || Array.isArray(params)) {
    throw new RpcError(RPC_ERROR.invalidParams, 'params must be an object');
  }
  return params as Record<string, unknown>;
}

export function requireString(params: Record<string, unknown>, key: string): string {
  const value = params[key];
  if (typeof value !== 'string' || !value.trim()) {
    throw new RpcError(RPC_ERROR.invalidParams, `missing string param: ${key}`);
  }
  return value;
}

export function optionalString(params: Record<string, unknown>, key: string): string | undefined {
  const value = params[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw new RpcError(RPC_ERROR.invalidParams, `param ${key} must be a string`);
  return value;
}

export function optionalNumber(params: Record<string, unknown>, key: string): number | undefined {
  const value = params[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new RpcError(RPC_ERROR.invalidParams, `param ${key} must be a number`);
  }
  return value;
}

export function requireObject(params: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = params[key];
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new RpcError(RPC_ERROR.invalidParams, `missing object param: ${key}`);
  }
  return value as Record<string, unknown>;
}
